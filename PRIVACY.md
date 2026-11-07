# Privacy Policy

Home Automation is a private, self-hosted app run by one household on its own home server. It is not offered to the public.

## What it accesses

The water bill sync uses read-only Gmail access (`gmail.readonly`) on the household's own Google account. It requests only the messages under the "Water Bill" label and downloads their PDF attachments.

## What it stores

From each bill it stores the billing period, the charges, the usage and a copy of the PDF. These are kept in a database on the household's home server and shown only to signed-in household members. No other email content is stored.

## Sharing

Nothing is sold, shared, or sent to anyone else. No data from Google is used for advertising or to train models.

Use of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements.

## Removing access

Access can be revoked at any time at https://myaccount.google.com/permissions. Stored bills can be deleted by the household from its own server.

Questions: open an issue on this repository.
