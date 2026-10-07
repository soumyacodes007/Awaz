# Awaz HubSpot app (OAuth)

The app every Awaz workspace uses for "Connect with HubSpot". It is a HubSpot
developer-platform project: an OAuth app with marketplace distribution, so any
HubSpot account can install it (25 accounts until it is listed on the HubSpot
App Marketplace, unlimited after).

## Deploy

```bash
npm install -g @hubspot/cli
cd integrations/hubspot-app
hs init            # sign in with a personal access key from your HubSpot developer account
hs project upload
```

Then in HubSpot: Development → Projects → awaz → Awaz → **Auth** tab. Copy the
client ID and client secret into the repo's root `.env`:

```
HUBSPOT_CLIENT_ID=...
HUBSPOT_CLIENT_SECRET=...
HUBSPOT_REDIRECT_URI=http://localhost:3000/api/v1/crm/hubspot/oauth/callback
```

and restart the api (`docker compose up -d api` in WSL). "Connect with HubSpot"
on the new campaign page turns on.

## Production

Add `https://<your-domain>/api/v1/crm/hubspot/oauth/callback` to `redirectUrls`
(HubSpot requires https except for localhost), `hs project upload` again, and set
`HUBSPOT_REDIRECT_URI` to it on the server. Add `crm.objects.contacts.write` to
`requiredScopes` when call outcomes are written back to contacts.
