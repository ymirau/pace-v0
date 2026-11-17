from functools import lru_cache

from pydantic import Field, computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Pace chat agent ---
    # The key the chat engine calls Claude with. Local-only for the spike; never
    # committed (backend/.env is gitignored).
    anthropic_api_key: str = Field("", alias="ANTHROPIC_API_KEY")
    pace_model: str = Field("claude-sonnet-5-5", alias="PACE_MODEL")
    pace_seed: str = Field("startup", alias="PACE_SEED")
    # A shared code the SPA sends as X-Pace-Access-Code. Empty = gate open (local
    # dev only). Set it in every deployed env: the chat spends real money.
    pace_access_code: str = Field("", alias="PACE_ACCESS_CODE")
    # A SECOND secret, for the log viewer at /viewer. Separate on purpose: the
    # reviewer code must not also read every other reviewer's transcript.
    pace_viewer_code: str = Field("", alias="PACE_VIEWER_CODE")

    # --- Postgres (shared Synveon instance) ---
    # pytest runs against this same URL and rolls back every change; CI points it
    # at a throwaway Postgres service (see .github/workflows/ci.yml).
    postgres_url: str = Field(..., alias="POSTGRES_URL")

    # --- SQL Server (optional read/write source) ---
    # Powers the /api/reports/* endpoints. With SQLSERVER_HOST unset they return 503
    # and the rest of the app is unaffected. SQL Server authentication only.
    sqlserver_host: str = Field(default="", alias="SQLSERVER_HOST")
    sqlserver_port: int = Field(default=1433, alias="SQLSERVER_PORT")
    sqlserver_database: str = Field(default="", alias="SQLSERVER_DATABASE")
    sqlserver_user: str = Field(default="", alias="SQLSERVER_USER")
    sqlserver_password: str = Field(default="", alias="SQLSERVER_PASSWORD")
    sqlserver_driver: str = Field(default="ODBC Driver 18 for SQL Server", alias="SQLSERVER_DRIVER")
    sqlserver_encrypt: str = Field(default="yes", alias="SQLSERVER_ENCRYPT")
    sqlserver_trust_server_certificate: str = Field(
        default="yes", alias="SQLSERVER_TRUST_SERVER_CERTIFICATE"
    )
    sqlserver_login_timeout: int = Field(default=10, alias="SQLSERVER_LOGIN_TIMEOUT")  # seconds
    sqlserver_query_timeout: int = Field(default=60, alias="SQLSERVER_QUERY_TIMEOUT")  # seconds

    # --- Email (notification mail and the support form) ---
    # Plain SMTP to Office 365's connector for the domain, which accepts mail from Synveon's
    # external IPs: no login, so nothing here is secret (app/services/mailer.py). OFF by
    # default, so local dev and the test suite never send. MAIL_REDIRECT_TO sends every
    # message to that one address instead, naming the intended recipient in the body:
    # set it on sbx/uat so testing never emails real people; leave it unset in prod.
    mail_enabled: bool = Field(default=False, alias="MAIL_ENABLED")
    mail_smtp_host: str = Field(default="", alias="MAIL_SMTP_HOST")
    mail_smtp_port: int = Field(default=25, alias="MAIL_SMTP_PORT")
    mail_starttls: bool = Field(default=True, alias="MAIL_STARTTLS")
    mail_sender: str = Field(default="", alias="MAIL_SENDER")
    mail_redirect_to: str = Field(default="", alias="MAIL_REDIRECT_TO")
    # Where the support form (routers/support.py) sends. Blank = the form can't send.
    support_email: str = Field(default="", alias="SUPPORT_EMAIL")

    # --- Auth bypass (LOCAL DEV ONLY) ---
    # When true, skip Azure token validation and treat every request as a fixed
    # dev user. The local backend/.env sets it; a deployed env refuses it (below).
    auth_disabled: bool = Field(default=False, alias="AUTH_DISABLED")

    # Set only on deployed envs (_deploy/envs/<slug>-<env>.env, e.g. pace-prod), never
    # in the local .env: its presence is how the app knows it's on a server.
    env_name: str = Field(default="", alias="ENV_NAME")

    # --- Azure AD / Entra ID auth ---
    # Every Synveon app and env signs in through the one shared, public Entra registration,
    # so its IDs are defaults here rather than settings in each env file (the frontend
    # has the same values in src/authConfig.ts). An env var still overrides them.
    # Directory (tenant) ID GUID.
    azure_tenant_id: str = Field(
        default="00000000-0000-0000-0000-000000000000", alias="AZURE_TENANT_ID"
    )
    # The `aud` claim we validate against. The shared registration issues v2.0 tokens,
    # whose `aud` is the client-ID GUID, not the App ID URI https://apps.example.com.
    azure_api_audience: str = Field(
        default="11111111-1111-1111-1111-111111111111", alias="AZURE_API_AUDIENCE"
    )
    # Optional override; defaults to the v2.0 issuer derived from the tenant ID.
    azure_issuer_override: str | None = Field(default=None, alias="AZURE_ISSUER")

    @model_validator(mode="after")
    def _no_auth_bypass_when_deployed(self) -> "Settings":
        # A backend/.env copied onto a server (the service runs in backend/, where
        # .env is read) must not switch token validation off there.
        if self.auth_disabled and self.env_name:
            raise ValueError(
                f"AUTH_DISABLED=true is for local development only, but ENV_NAME="
                f"{self.env_name} says this is a deployed env. Remove AUTH_DISABLED "
                f"(check for a backend/.env on this host) and restart."
            )
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def azure_issuer(self) -> str:
        if self.azure_issuer_override:
            return self.azure_issuer_override
        return f"https://login.microsoftonline.com/{self.azure_tenant_id}/v2.0"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def azure_jwks_uri(self) -> str:
        return f"https://login.microsoftonline.com/{self.azure_tenant_id}/discovery/v2.0/keys"


@lru_cache
def get_settings() -> Settings:
    return Settings()
