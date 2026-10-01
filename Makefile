.ONESHELL:
SHELL := /bin/bash
.SHELLFLAGS := -ec
.DEFAULT_GOAL := help

help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}'


#######################
# Env vars
#######################
IMAGE_VERSION := 1.6.1
IMAGE_NAME ?= mcp-marketplace
IMAGE ?= ghcr.io/bcollard/$(IMAGE_NAME)


######################
# Docker commands
######################
.PHONY: docker-build docker-stop docker-run docker-exec docker-cleanup

docker-build: ## Build the Docker image for Keycloak
	@docker build -t $(IMAGE):$(IMAGE_VERSION) .

docker-stop: ## Stop and remove the Docker container
	@docker stop $(IMAGE_NAME) || true
	@docker rm $(IMAGE_NAME) || true

docker-run: docker-build ## Build and run the Keycloak Docker container
	@docker run -d --name $(IMAGE_NAME) \
		-p 3001:3001 \
		-e TOKEN_EXCHANGE_URL=https://keycloak.kong.runlocal.dev/realms/bco/protocol/openid-connect/token \
		-e CLIENT_ID_TE_SAME_DOMAIN=mcp-marketplace \
		-e CLIENT_SECRET_TE_SAME_DOMAIN=Z4JCQi7icyWLui9TI2tYApvIrSO6OSwj \
		-e CLIENT_ID_JWT_OTHER_DOMAIN=mcp-marketplace-jwt \
		-e CLIENT_SECRET_JWT_OTHER_DOMAIN=<your-jwt-client-secret> \
		-e TOKEN_EXCHANGE_TARGET_RESOURCE=https://api.runlocal.dev/httpbin \
		-e TOKEN_EXCHANGE_TARGET_SCOPES="httpbin:read httpbin:write" \
		-e JWT_BEARER_TOKEN_EXCHANGE_URL=https://keycloak.kong.runlocal.dev/realms/bco/protocol/openid-connect/token \
		-e JWT_BEARER_TARGET_RESOURCE=https://api.runlocal.dev/httpbin \
		-e JWT_BEARER_TARGET_SCOPES="httpbin:read httpbin:write" \
		-e LOG_LEVEL=INFO \
		$(IMAGE):$(IMAGE_VERSION)

docker-exec: ## Execute a bash shell inside the running Keycloak container
	@docker exec -it $(IMAGE_NAME) /bin/bash

docker-cleanup: docker-stop ## Clean up Docker container
	@docker rmi $(IMAGE):$(IMAGE_VERSION) || true

docker-push: docker-build ## Build and push the Docker image to GHCR (requires GITHUB_PAT_CONTAINER_REGISTRY env var)
	@echo "$$GITHUB_PAT_CONTAINER_REGISTRY" | docker login ghcr.io -u $(GITHUB_USER) --password-stdin
	@docker push $(IMAGE):$(IMAGE_VERSION)


######################
# Helm commands
######################
HELM_RELEASE      ?= mcp-marketplace
HELM_CHART        := helm/mcp-marketplace
HELM_CHART_VERSION := $(shell grep '^version:' $(HELM_CHART)/Chart.yaml | awk '{print $$2}')
HELM_NS           ?= mcp
HELM_OCI_REPO     := oci://ghcr.io/bcollard/charts
GITHUB_USER       ?= bcollard

.PHONY: helm-login helm-package helm-push

helm-login: ## Authenticate Helm with GHCR (requires GITHUB_PAT_CONTAINER_REGISTRY env var)
	@helm registry login ghcr.io \
		--username $(GITHUB_USER) \
		--password-stdin <<< "$$GITHUB_PAT_CONTAINER_REGISTRY"

helm-package: ## Package the Helm chart into dist/
	@mkdir -p dist
	@helm package $(HELM_CHART) --destination dist/

helm-push: helm-package ## Package and push the Helm chart to GHCR OCI registry (requires prior helm-login or GITHUB_PAT_CONTAINER_REGISTRY)
	@helm push dist/$(HELM_RELEASE)-$(HELM_CHART_VERSION).tgz $(HELM_OCI_REPO)
	@echo "Chart available at: $(HELM_OCI_REPO)/$(HELM_RELEASE):$(HELM_CHART_VERSION)"
