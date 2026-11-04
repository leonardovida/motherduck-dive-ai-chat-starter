output "app_url" {
  value       = local.app_url
  description = "The app address. APP_URL is already set to it."
}

output "secrets_used" {
  value       = sort(values(local.secret_id))
  description = "The Secret Manager secrets the app reads."
}

output "load_balancer_ip" {
  value       = local.use_domain ? google_compute_global_address.app[0].address : null
  description = "With a domain: point an A record for the domain at this address."
}
