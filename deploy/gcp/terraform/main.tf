# Runs the starter's container image on Cloud Run, with secrets from Secret Manager and the two
# vercel.json crons as Cloud Scheduler jobs. See docs/deploy.md.
#
# Terraform never handles secret values: it reads only the names of secrets you create first
# (deploy/gcp/scripts/create-secrets.sh), so they stay out of the state file.

data "google_project" "this" {
  project_id = var.project_id
}

locals {
  use_domain  = var.domain != ""
  sign_in     = var.sign_in_mode == "accounts" ? "MOTHERDUCK_APP_TOKEN" : "DEMO_PASSWORD"
  secrets     = toset(concat(["SESSION_SECRET", "CRON_SECRET", local.sign_in], var.secret_names))
  secret_id   = { for name in local.secrets : name => "${var.secret_prefix}-${name}" }
  default_url = "https://${var.service_name}-${data.google_project.this.number}.${var.region}.run.app"
  app_url     = local.use_domain ? "https://${var.domain}" : local.default_url
  # Only the load balancer can guarantee this header (load_balancer.tf), so it is set only with a domain.
  trusted_ip_header = local.use_domain ? { AUTH_TRUSTED_IP_HEADER = "x-client-ip" } : {}
  environment       = merge(var.settings, { APP_URL = local.app_url }, local.trusted_ip_header)
  cron_jobs = {
    daily  = { route = "/api/cron/daily", schedule = "17 4 * * *", description = "Daily upkeep: retention and MotherDuck grants" }
    digest = { route = "/api/cron/digest", schedule = "0 8 * * 1", description = "Weekly digest, Mondays 08:00 UTC" }
  }
}

resource "google_project_service" "apis" {
  for_each           = toset(concat(["run.googleapis.com", "secretmanager.googleapis.com", "cloudscheduler.googleapis.com", "iam.googleapis.com"], local.use_domain ? ["compute.googleapis.com"] : []))
  service            = each.value
  disable_on_destroy = false
}

# Fails the plan, before anything is created, when a secret has not been created yet.
# create-secrets.sh has already turned on Secret Manager, so this is read while planning. A
# depends_on here would postpone the read until after the APIs and service accounts exist.
data "google_secret_manager_secret" "app" {
  for_each  = local.secret_id
  secret_id = each.value
}

resource "google_service_account" "app" {
  # Service account IDs hold at most 30 characters, so a long service name is shortened first.
  account_id   = "${substr(var.service_name, 0, 24)}-app"
  display_name = "MotherDuck Dive + AI Chat (app and scheduled calls)"
  depends_on   = [google_project_service.apis]
}

resource "google_secret_manager_secret_iam_member" "app" {
  for_each  = data.google_secret_manager_secret.app
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.app.member
}

resource "google_cloud_run_v2_service" "app" {
  name                 = var.service_name
  location             = var.region
  deletion_protection  = false
  invoker_iam_disabled = true # A public web app; the app's own sign-in protects it.
  # With a domain, only the load balancer (which sets the trusted client-IP header) reaches the app:
  # internet traffic must come through it, and the run.app address, which sources inside the
  # project could still call with any header, is turned off.
  ingress              = local.use_domain ? "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER" : "INGRESS_TRAFFIC_ALL"
  default_uri_disabled = local.use_domain

  template {
    service_account = google_service_account.app.email
    timeout         = "300s"
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }
    containers {
      image = var.image
      ports {
        container_port = 3000
      }
      resources {
        limits = { cpu = "1", memory = "1Gi" }
        # Keep CPU between requests: the app finishes some work, such as a MotherDuck access sync,
        # after it has answered.
        cpu_idle          = false
        startup_cpu_boost = true
      }
      dynamic "env" {
        for_each = local.environment
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.secret_id
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      startup_probe {
        http_get {
          path = "/api/auth"
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = var.sign_in_mode == "accounts" || local.use_domain
      error_message = "Password sign-in needs a trusted client-IP header, which only the load balancer provides on Cloud Run. Set domain, or use sign_in_mode = \"accounts\". See docs/deploy.md."
    }
    precondition {
      condition     = local.use_domain || length("${var.service_name}-${data.google_project.this.number}") <= 63
      error_message = "The service name is too long for Cloud Run's predictable URL. Use a shorter service_name."
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.app]
}

# The two vercel.json crons. Cloud Scheduler starts a Cloud Run job, which runs the app image once
# to call the route with CRON_SECRET (deploy/cron.mjs), so the secret never leaves Secret Manager.
resource "google_cloud_run_v2_job" "cron" {
  for_each            = local.cron_jobs
  name                = "${var.service_name}-cron-${each.key}"
  location            = var.region
  deletion_protection = false

  template {
    template {
      service_account = google_service_account.app.email
      max_retries     = 1
      timeout         = "600s"
      containers {
        image   = var.image
        command = ["node"]
        args    = ["deploy/cron.mjs", each.value.route]
        resources {
          limits = { cpu = "1", memory = "512Mi" }
        }
        env {
          name  = "APP_URL"
          value = local.app_url
        }
        env {
          name = "CRON_SECRET"
          value_source {
            secret_key_ref {
              secret  = local.secret_id["CRON_SECRET"]
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [google_secret_manager_secret_iam_member.app]
}

resource "google_service_account" "scheduler" {
  account_id   = "${substr(var.service_name, 0, 24)}-sched"
  display_name = "MotherDuck Dive + AI Chat (starts the scheduled jobs)"
  depends_on   = [google_project_service.apis]
}

resource "google_cloud_run_v2_job_iam_member" "scheduler" {
  for_each = google_cloud_run_v2_job.cron
  name     = each.value.name
  location = each.value.location
  role     = "roles/run.invoker"
  member   = google_service_account.scheduler.member
}

resource "google_cloud_scheduler_job" "cron" {
  for_each         = local.cron_jobs
  name             = "${var.service_name}-cron-${each.key}"
  region           = var.region
  description      = each.value.description
  schedule         = each.value.schedule
  time_zone        = "Etc/UTC"
  attempt_deadline = "320s"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.cron[each.key].name}:run"
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_cloud_run_v2_job_iam_member.scheduler]
}
