# IVR-CRM: Zoho Mail setup

Each agent connects their own Zoho mailbox from **IVR-CRM → Connections**, so the emails they send members go from their own address.
The application is registered in Zoho once.

This is separate from the hub's own email (the `SMTP_*` settings, which send the hub's notifications from one mailbox).

## 1. Register the application

1. Open the Zoho API Console for your data centre and sign in with an admin account:
   - India: https://api-console.zoho.in
   - US: https://api-console.zoho.com
   - EU: https://api-console.zoho.eu
2. Choose **Add Client**, then **Server-based Applications**.
3. Set the **Authorized Redirect URI** to `<APP_BASE_URL>/api/ivr/zoho/callback`, for example `https://mccia-apphub.vercel.app/api/ivr/zoho/callback`.
   It must match `APP_BASE_URL` exactly, including `https` and no trailing slash.
4. Copy the **Client ID** and **Client Secret**.

## 2. Environment variables (Vercel)

| Variable | Value |
| --- | --- |
| `ZOHO_CLIENT_ID` | Client ID from the console |
| `ZOHO_CLIENT_SECRET` | Client Secret from the console |
| `ZOHO_DOMAIN` | `zoho.in` (India, the default), `zoho.com` or `zoho.eu`. It must match the console used above |
| `APP_BASE_URL` | The hub's address, already set for the hub |

## 3. Scopes

IVR-CRM asks for:

- `ZohoMail.messages.CREATE` to send mail
- `ZohoMail.accounts.READ` to find the mail account and the sender address

It asks for offline access, so each agent approves once. If Zoho later refuses the stored token, the agent sees a "reconnect" message and connects
again from Connections. The tokens are stored encrypted with `IVR_ENCRYPTION_KEY`.
