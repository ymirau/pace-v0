/**
 * Skip Azure/MSAL auth when the page is NOT served over HTTPS. Azure App Proxy always serves HTTPS in the
 * deployed environments, so this only ever triggers in local dev / internal
 * HTTP testing — never in sbx/uat/prod.
 */
export const AUTH_BYPASS = window.location.protocol !== "https:";
