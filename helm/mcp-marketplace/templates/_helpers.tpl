{{/*
Expand the name of the chart.
*/}}
{{- define "mcp-marketplace.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "mcp-marketplace.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart label value (name + version).
*/}}
{{- define "mcp-marketplace.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "mcp-marketplace.labels" -}}
helm.sh/chart: {{ include "mcp-marketplace.chart" . }}
{{ include "mcp-marketplace.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (used in Deployment matchLabels and Service selector).
*/}}
{{- define "mcp-marketplace.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mcp-marketplace.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "mcp-marketplace.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "mcp-marketplace.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the Secret that holds CLIENT_SECRET_TE_SAME_DOMAIN (RFC 8693 token exchange).
*/}}
{{- define "mcp-marketplace.teSecretName" -}}
{{- if .Values.tokenExchange.clientSecret.create }}
{{- printf "%s-te-credentials" (include "mcp-marketplace.fullname" .) }}
{{- else }}
{{- required "tokenExchange.clientSecret.existingSecretName is required when tokenExchange.clientSecret.create=false" .Values.tokenExchange.clientSecret.existingSecretName }}
{{- end }}
{{- end }}

{{/*
Name of the Secret that holds CLIENT_SECRET_JWT_OTHER_DOMAIN (RFC 7523 JWT Bearer grant).
*/}}
{{- define "mcp-marketplace.jwtSecretName" -}}
{{- if .Values.jwtBearer.clientSecret.create }}
{{- printf "%s-jwt-credentials" (include "mcp-marketplace.fullname" .) }}
{{- else }}
{{- required "jwtBearer.clientSecret.existingSecretName is required when jwtBearer.clientSecret.create=false" .Values.jwtBearer.clientSecret.existingSecretName }}
{{- end }}
{{- end }}
