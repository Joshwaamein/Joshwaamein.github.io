---
layout: post
title: "How to Update Cloudflare DNS for a Dynamic IP Address via Cloudflare API"
date: 2025-01-07
categories: ["Networking", "DevOps"]
tags: ["cloudflare", "dns", "bash", "api", "automation"]
description: "This guide will demonstrate how to configure a script that updates your DNS record in a series of straightforward steps. We&#8217;ll begin by installing the necessary dependencies, then proceed to gat"
---
If you’re self-hosting anything at home and your ISP doesn’t give you a static IP, you’ve probably run into the annoying problem of your public IP changing and your DNS records going stale. Instead of manually updating your Cloudflare DNS every time that happens, let’s automate the whole thing with a simple bash script and a cron job. It’s quick, easy, and once it’s set up you can forget about it.


This guide will demonstrate how to configure a script that updates your DNS record in a series of straightforward steps. We’ll begin by installing the necessary dependencies, then proceed to gather your essential information. Subsequently, we’ll create the script, make it executable, and finally, schedule it to run automatically at predetermined intervals.

### Install JQ

The `jq` command-line tool is used in the script for parsing and manipulating JSON data.

```bash
sudo apt install jq -y
```

### Gather Data

To obtain your Cloudflare API token and Zone ID, follow these steps:

#### Obtaining API Token

1.  Log in to your Cloudflare account dashboard.
2.  Click on the profile icon in the upper-right corner and select “My Profile”.
3.  In the left sidebar, click on “API Tokens”.
4.  Click the “Create Token” button.
5.  You can either use a template or create a custom token:

-   For a template, select “Edit zone DNS” and click “Use template”.
-   For a custom token, click “Get started” under “Custom token”.

1.  Set the token name and adjust permissions as needed.
2.  Under “Zone Resources”, select the specific zones or include all zones.
3.  Click “Continue to summary” and then “Create Token”.
4.  Copy and securely store the generated token.

#### Finding Zone ID

1.  Log in to the Cloudflare dashboard.
2.  Select the domain for which you need the Zone ID.
3.  On the Overview page for your domain, look for the “API” section in the right column.
4.  Your Zone ID will be displayed there. Click to copy it.

Alternatively, you can also find the Zone ID using the API:

```bash
curl -X GET "https://api.cloudflare.com/client/v4/zones" \
     -H "Authorization: Bearer <your_api_token>" \
     -H "Content-Type: application/json"
```

Replace `<your_api_token>` with the API token you generated.

Remember to keep your API token and Zone ID secure, as they provide access to your Cloudflare account and specific domain settings.

## Cloudflare API Script:

Here’s a basic outline of what the update script looks like:

```bash
#!/bin/bash

# Your Cloudflare API details
API_TOKEN="your_api_token"
ZONE_ID="your_zone_id"
RECORD_NAME="x.domain.com"

# Get current public IP
CURRENT_IP=$(curl -s https://api.ipify.org)

# Get existing DNS record
DNS_RECORD=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=$RECORD_NAME" \
     -H "Authorization: Bearer $API_TOKEN" \
     -H "Content-Type: application/json")

# Extract the existing IP and record ID
EXISTING_IP=$(echo $DNS_RECORD | jq -r '.result[0].content')
RECORD_ID=$(echo $DNS_RECORD | jq -r '.result[0].id')

# Update if IP has changed
if [ "$CURRENT_IP" != "$EXISTING_IP" ]; then
    curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
         -H "Authorization: Bearer $API_TOKEN" \
         -H "Content-Type: application/json" \
         --data "{\"type\":\"A\",\"name\":\"$RECORD_NAME\",\"content\":\"$CURRENT_IP\",\"ttl\":1,\"proxied\":false}"
    echo "Updated $RECORD_NAME to $CURRENT_IP"
else
    echo "IP unchanged"
fi
echo 'script finished at' $(date)
```

Save this with a .sh file extension and run:

```bash
chmod a+x script_name.sh
```

### Configure the CRON Job

To configure your script to run as a cron job on a schedule, you need to add an entry to your crontab file. Here’s how to do it:

1.  Open your crontab file for editing:

```bash
crontab -e
```

2.  Add the following line to the file to run the script every 15 minutes:

```bash
*/15 * * * * /path/to/your/script_name.sh >> script_name.txt
```

Replace `/path/to/your/` with the actual path to your script.

This cron expression breaks down as follows:

-   `*/15`: Run every 15 minutes
-   `* * * *`: Run every hour, every day of the month, every month, and every day of the week

1.  Save and exit the editor. The cron daemon will automatically detect the changes.

Your script will now run every 15 minutes. The script will also redirect and append its output to a text file named script\_name.txt. Make sure the script has the necessary permissions to execute and that all paths within the script are absolute.

---

That’s all there is to it! Once the cron job is running, your Cloudflare DNS record will stay in sync with your dynamic IP automatically. No more stale records or manual updates — just set it and forget it.

Cheers 🍻
