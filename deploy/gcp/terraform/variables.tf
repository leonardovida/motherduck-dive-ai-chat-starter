variable "project_id" {
  type        = string
  description = "The Google Cloud project to deploy into."
}

variable "region" {
  type        = string
  default     = "us-central1"
  description = "The Cloud Run and Cloud Scheduler region."
}

variable "service_name" {
  type        = string
  default     = "motherduck-dive-chat"
  description = "The Cloud Run service name. The scheduled jobs and service accounts are named after it."
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,40}[a-z0-9]$", var.service_name))
    error_message = "Use 2 to 42 lowercase letters, digits and hyphens, starting with a letter."
  }
}

variable "image" {
  type        = string
  default     = "ghcr.io/leonardovida/motherduck-dive-ai-chat-starter:latest"
  description = "The container image. Use a release tag, such as :0.6.0, to control upgrades."
}

variable "secret_prefix" {
  type        = string
  default     = "motherduck-dive-chat"
  description = "Secret Manager secrets are named <secret_prefix>-<SETTING>, for example motherduck-dive-chat-SESSION_SECRET."
  validation {
    condition     = can(regex("^[A-Za-z0-9_-]{1,100}$", var.secret_prefix))
    error_message = "Use letters, digits, underscores and hyphens."
  }
}

variable "sign_in_mode" {
  type        = string
  default     = "accounts"
  description = "accounts (MOTHERDUCK_APP_TOKEN) or password (DEMO_PASSWORD). Password sign-in needs a domain; see docs/deploy.md."
  validation {
    condition     = contains(["accounts", "password"], var.sign_in_mode)
    error_message = "Use accounts or password."
  }
}

variable "secret_names" {
  type        = list(string)
  default     = ["MOTHERDUCK_EMBED_TOKEN", "MOTHERDUCK_CHAT_TOKEN", "OPENAI_API_KEY"]
  description = "Settings read from Secret Manager, besides SESSION_SECRET, CRON_SECRET and the sign-in secret. Add your model provider's key here."
  validation {
    condition     = alltrue([for name in var.secret_names : can(regex("^[A-Z][A-Z0-9_]*$", name)) && !contains(["SESSION_SECRET", "CRON_SECRET", "DEMO_PASSWORD", "MOTHERDUCK_APP_TOKEN", "APP_URL", "AUTH_TRUSTED_IP_HEADER"], name)])
    error_message = "Use upper-case setting names. SESSION_SECRET, CRON_SECRET, the sign-in secret, APP_URL and AUTH_TRUSTED_IP_HEADER are added automatically."
  }
}

variable "settings" {
  type        = map(string)
  default     = {}
  description = "Plain, non-secret settings, such as MOTHERDUCK_EMBED_USERNAME, DIVE_OVERVIEW_ID and DIVE_OVERVIEW_CHAT_DATABASE. See docs/configuration.md."
  validation {
    condition     = alltrue([for name in keys(var.settings) : can(regex("^[A-Z][A-Z0-9_]*$", name)) && !contains(["APP_URL", "AUTH_TRUSTED_IP_HEADER", "PORT"], name)])
    error_message = "Use upper-case setting names. APP_URL and AUTH_TRUSTED_IP_HEADER are set automatically."
  }
}

variable "domain" {
  type        = string
  default     = ""
  description = "Optional: your own domain, such as dives.example.com. Adds an HTTPS load balancer that sets a trusted client-IP header, which password sign-in needs."
}

variable "min_instances" {
  type        = number
  default     = 0
  description = "Instances kept running. 0 scales to zero when idle; the first request then takes a few seconds."
}

variable "max_instances" {
  type        = number
  default     = 2
  description = "The most instances Cloud Run starts. Sign-in limits are kept per instance."
}
