# Optional (set var.domain): a global external Application Load Balancer in front of Cloud Run.
# It overwrites X-Client-IP with the address the client connected from, so the app can trust it
# for AUTH_TRUSTED_IP_HEADER, and the service accepts traffic only through the load balancer
# (main.tf turns off its run.app address). Point an A record for the domain at the
# `load_balancer_ip` output; the Google-managed certificate becomes active once DNS resolves
# (often 15 to 60 minutes). Resources that do not lead back to the Cloud Run service wait for
# the Compute Engine API explicitly.

resource "google_compute_region_network_endpoint_group" "app" {
  count                 = local.use_domain ? 1 : 0
  name                  = "${var.service_name}-neg"
  region                = var.region
  network_endpoint_type = "SERVERLESS"
  cloud_run {
    service = google_cloud_run_v2_service.app.name
  }
}

resource "google_compute_backend_service" "app" {
  count                  = local.use_domain ? 1 : 0
  name                   = "${var.service_name}-backend"
  load_balancing_scheme  = "EXTERNAL_MANAGED"
  protocol               = "HTTPS"
  custom_request_headers = ["X-Client-IP: {client_ip_address}"]
  backend {
    group = google_compute_region_network_endpoint_group.app[0].id
  }
}

resource "google_compute_url_map" "app" {
  count           = local.use_domain ? 1 : 0
  name            = "${var.service_name}-https"
  default_service = google_compute_backend_service.app[0].id
}

resource "google_compute_managed_ssl_certificate" "app" {
  count = local.use_domain ? 1 : 0
  name  = "${var.service_name}-cert"
  managed {
    domains = [var.domain]
  }
  depends_on = [google_project_service.apis]
}

resource "google_compute_target_https_proxy" "app" {
  count            = local.use_domain ? 1 : 0
  name             = "${var.service_name}-https"
  url_map          = google_compute_url_map.app[0].id
  ssl_certificates = [google_compute_managed_ssl_certificate.app[0].id]
}

resource "google_compute_global_address" "app" {
  count      = local.use_domain ? 1 : 0
  name       = "${var.service_name}-ip"
  depends_on = [google_project_service.apis]
}

resource "google_compute_global_forwarding_rule" "https" {
  count                 = local.use_domain ? 1 : 0
  name                  = "${var.service_name}-https"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.app[0].address
  port_range            = "443"
  target                = google_compute_target_https_proxy.app[0].id
}

# Plain http requests are redirected to https.
resource "google_compute_url_map" "redirect" {
  count = local.use_domain ? 1 : 0
  name  = "${var.service_name}-redirect"
  default_url_redirect {
    https_redirect = true
    strip_query    = false
  }
  depends_on = [google_project_service.apis]
}

resource "google_compute_target_http_proxy" "redirect" {
  count   = local.use_domain ? 1 : 0
  name    = "${var.service_name}-redirect"
  url_map = google_compute_url_map.redirect[0].id
}

resource "google_compute_global_forwarding_rule" "http" {
  count                 = local.use_domain ? 1 : 0
  name                  = "${var.service_name}-http"
  load_balancing_scheme = "EXTERNAL_MANAGED"
  ip_address            = google_compute_global_address.app[0].address
  port_range            = "80"
  target                = google_compute_target_http_proxy.redirect[0].id
}
