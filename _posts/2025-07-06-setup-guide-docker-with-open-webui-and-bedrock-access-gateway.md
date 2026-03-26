---
layout: post
title: "Setup Guide: Docker with Open WebUI and Bedrock Access Gateway"
date: 2025-07-06
categories: ["Cloud", "DevOps"]
tags: ["docker", "aws", "bedrock", "ai", "openwebui", "linux"]
description: "This guide documents the process of setting up a Docker environment with Open WebUI and Bedrock Access Gateway on an Ubuntu 24.04 server."
---

Looking to run your own AI chat interface powered by AWS Bedrock? In this guide, I'll walk you through the entire setup from scratch.

**Unlock the power of advanced AI models on your own server!** This comprehensive guide will walk you through setting up a robust Docker environment with Open WebUI for a user-friendly interface and the Bedrock Access Gateway to connect to AWS Bedrock models, all on your Ubuntu 24.04 server.

## You Will Need

-   A server running Ubuntu 24.04 or similar Linux distribution
-   SSH access to the server with sudo/root privileges
-   AWS account with Bedrock model access (ensure you have requested and been granted access to the specific models you intend to use in the chosen region)
-   AWS credentials (Access Key ID and Secret Access Key)
-   ~2GB of RAM and 10GB of free disk space (minimum; more recommended for heavy AI model usage)
-   Open ports (3000, 8000) or ability to configure firewall
-   Basic knowledge of terminal commands and Docker concepts

**Tip:** Throughout this guide, "your-server-ip" refers to your server’s public IP address. You can typically find this using commands like `ip a` or `hostname -I` in your terminal.

## 1\. Create your AWS user and Access Keys

1.  Log in to your AWS Management Console
2.  Navigate to IAM (Identity and Access Management)
3.  Create a new user or use an existing one with programmatic access.
4.  Attach the `AmazonBedrockFullAccess` policy to the user.
5.  Generate and securely save the Access Key ID and Secret Access Key. **These will be needed in Step 6.**

**(Optional) Screenshot:** Include a screenshot of the AWS IAM console showing user creation and policy attachment.

## 2\. Docker Installation

First, let’s get Docker and its essential components installed on your Ubuntu server.

```bash
# Update package list and install prerequisites
sudo apt-get update
sudo apt-get install ca-certificates curl gnupg -y

# Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Add the Docker repository to Apt sources
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Update Apt package list and install Docker packages
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin -y

# Verify Docker installation
sudo docker run hello-world

# Add your current user to the docker group to run commands without sudo
# This is highly recommended for convenience.
sudo usermod -aG docker $USER

# To apply the new group membership, you MUST either:
# 1. Log out of your SSH session and log back in.
# 2. Reboot your server.
# After logging back in, you can verify by running 'docker run hello-world' without 'sudo'.
echo "Please log out and log back in (or reboot) to apply Docker group changes."
```

## 3\. Deploy Open WebUI for Ollama

Next, we’ll deploy Open WebUI, which provides a user-friendly interface that will be essential for interacting with your AI models. This command will pull the Open WebUI image and run it as a container.

```bash
docker run -d -p 3000:8080 \
  -v ollama:/root/.ollama \
  -v open-webui:/app/backend/data \
  --name open-webui \
  --restart always \
  ghcr.io/open-webui/open-webui:ollama
```

The `-v` flags in the command above create persistent Docker volumes (`ollama` and `open-webui`) to ensure your Ollama models and Open WebUI data are not lost if the container is removed. Open WebUI will be available at **[http://your-server-ip:3000](http://your-server-ip:3000)**.

## 4\. Setup Bedrock Access Gateway

The Bedrock Access Gateway (BAG) acts as a secure intermediary, allowing your Open WebUI instance to communicate with AWS Bedrock’s powerful AI models. Let’s clone its repository and build its Docker image. We’ll perform these steps in your home directory, for example, `~/bedrock-access-gateway`.

```bash
# Navigate to your home directory (or a preferred location)
cd ~

# Clone the repository
git clone https://github.com/aws-samples/bedrock-access-gateway.git
cd bedrock-access-gateway/src

# Rename Dockerfile_ecs to Dockerfile (required for local Docker build)
mv ./Dockerfile_ecs ./Dockerfile

# Build the Docker image. This might take a few minutes.
docker build . -f Dockerfile -t bedrock-gateway
```

## 5\. Configure Firewall

To ensure Open WebUI and the Bedrock Access Gateway are accessible from outside your server, we need to configure your server’s firewall (UFW).

```bash
sudo ufw allow 8000/tcp  # For Bedrock Access Gateway
sudo ufw allow 3000/tcp  # For Open WebUI access
sudo ufw enable         # Enable the firewall (if not already enabled)
sudo ufw reload         # Apply the new rules
```

## 6\. Run Bedrock Access Gateway Container

Now, we’ll run the Bedrock Access Gateway container, providing it with your AWS credentials. For more detailed documentation, refer to the official repository here: [https://github.com/aws-samples/bedrock-access-gateway](https://github.com/aws-samples/bedrock-access-gateway)

**Important:** Ensure the `AWS_REGION` you specify here matches the region where your Bedrock models are enabled (see Step 7).

**Option 1: Using environment variables (not recommended for production):**

```bash
# Set AWS credentials as environment variables for the current session
export AWS_ACCESS_KEY_ID="YOUR_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="YOUR_SECRET_ACCESS_KEY"
export AWS_REGION="us-east-1"  # IMPORTANT: Change to your AWS region (e.g., us-east-2, us-west-2, eu-central-1)

# Run the container with AWS credentials passed as environment variables
docker run -d -p 8000:80 \
  -e AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY \
  -e AWS_REGION=$AWS_REGION \
  --name bedrock-gateway \
  --restart always \
  bedrock-gateway
```

**Option 2: Using AWS credentials file (recommended for production):**

```bash
# Create the .aws directory in your user's home folder if it doesn't exist
mkdir -p ~/.aws

# Create the credentials file and populate it with your AWS keys and region
# Replace YOUR_ACCESS_KEY_ID, YOUR_SECRET_ACCESS_KEY, and us-east-1 with your actual values.
cat > ~/.aws/credentials << EOF
[default]
aws_access_key_id = YOUR_ACCESS_KEY_ID
aws_secret_access_key = YOUR_SECRET_ACCESS_KEY
region = us-east-1
EOF

# Run container with the host's ~/.aws directory mounted as read-only into the container's root user's home directory.
docker run -d -p 8000:80 \
  -v ~/.aws:/root/.aws:ro \
  --name bedrock-gateway \
  --restart always \
  bedrock-gateway
```

You should now see the Bedrock Access Gateway’s Swagger UI page on the following link:  
**[http://your-server-ip:8000/docs](http://your-server-ip:8000/docs)**

**(Optional) Screenshot:** Include a screenshot of the Bedrock Access Gateway Swagger UI page.

## 7\. Configure Access to Models in Bedrock

This is a crucial step! Make sure you grant access to the specific Bedrock models you want to use in the AWS region you have selected (e.g., `us-east-1`). If your region is different, adjust the URL accordingly.

Go to the AWS Bedrock Model Access page for your region (e.g., for us-east-1: [https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess](https://us-east-1.console.aws.amazon.com/bedrock/home?region=us-east-1#/modelaccess)). Enable access for the models you plan to use (e.g., Anthropic Claude, Amazon Titan).

**(Optional) Screenshot:** Include a screenshot of the AWS Bedrock Model Access page showing enabled models.

## 8\. Integrating Open WebUI with Bedrock Gateway

Now, let’s connect Open WebUI to your newly deployed Bedrock Access Gateway. For additional details, see the OpenWebUI guide here: [https://docs.openwebui.com/tutorials/integrations/amazon-bedrock/](https://docs.openwebui.com/tutorials/integrations/amazon-bedrock/)

Go to **[http://your-server-ip:3000](http://your-server-ip:3000)**.

-   Under the Admin Panel, navigate to Settings -> Connections.
-   Use the "+" (plus) button to add a new connection under the OpenAI section.
-   For the **URL**, use "[http://your-server-ip:8000/api/v1](http://your-server-ip:8000/api/v1)" if Open WebUI and Bedrock Gateway are on different hosts or if you prefer direct IP access. **If both containers are running on the same Docker host and are part of the default Docker bridge network (which they are with the commands provided), you can use the internal Docker network name: "[http://bedrock-gateway:80/api/v1](http://bedrock-gateway:80/api/v1)"**.
-   For the **password**, the default password defined in BAG is "**bedrock**". You can change this password by setting the `DEFAULT_API_KEYS` environment variable when running the Bedrock Access Gateway container (e.g., `-e DEFAULT_API_KEYS='{"bedrock": "your_new_secret_password"}'`).
-   Click the "Verify Connection" button. You should see a "Server connection verified" alert in the top-right corner.

**(Optional) Screenshot:** Include a screenshot of the Open WebUI Connections settings and the "Server connection verified" alert.

## 9\. Securing Your Setup

For production environments, consider implementing these additional security measures:

1.  **Set up HTTPS/SSL:** Secure communication between your browser and Open WebUI (and potentially between Open WebUI and Bedrock Access Gateway) using a reverse proxy like Nginx or Caddy with Let’s Encrypt certificates.
2.  **Restrict network access:** Use ufw rules to limit access to ports 3000 and 8000 to only necessary IP addresses or trusted networks.
3.  **Implement Docker security best practices:** Run containers with the least necessary privileges, regularly scan your Docker images for vulnerabilities, and consider using [Docker secrets](https://docs.docker.com/engine/swarm/secrets/) for sensitive information (like AWS credentials) instead of environment variables.

## 10\. Backup and Persistence

Docker volumes contain all your data. Back them up regularly to prevent data loss:

```bash
# Create a dedicated backup directory
mkdir -p ~/backups

# Backup Ollama models volume
docker run --rm -v ollama:/source:ro -v ~/backups:/backup alpine tar -czvf /backup/ollama-backup-$(date +%F).tar.gz -C /source .

# Backup Open WebUI data volume
docker run --rm -v open-webui:/source:ro -v ~/backups:/backup alpine tar -czvf /backup/open-webui-backup-$(date +%F).tar.gz -C /source .
```

## 11\. Maintenance and Updates

To update your containers when new versions are released, follow these steps. Always back up your data first (Step 10).

```bash
# --- For Open WebUI Update ---
# 1. Pull the latest image
docker pull ghcr.io/open-webui/open-webui:ollama
# 2. Stop and remove the old container
docker stop open-webui
docker rm open-webui
# 3. Re-run the container with the latest image (use the exact command from Step 3)
docker run -d -p 3000:8080 \
  -v ollama:/root/.ollama \
  -v open-webui:/app/backend/data \
  --name open-webui \
  --restart always \
  ghcr.io/open-webui/open-webui:ollama

# --- For Bedrock Access Gateway Update ---
# 1. Navigate to the gateway's source directory
cd ~/bedrock-access-gateway/src
# 2. Pull the latest code from the repository
git pull
# 3. Rebuild the Docker image
docker build . -f Dockerfile -t bedrock-gateway
# 4. Stop and remove the old container
docker stop bedrock-gateway
docker rm bedrock-gateway
# 5. Re-run the container with the latest image (use the exact command from Step 6, Option 1 or 2)
# Example for Option 2 (recommended):
# docker run -d -p 8000:80 \
#   -v ~/.aws:/root/.aws:ro \
#   --name bedrock-gateway \
#   --restart always \
#   bedrock-gateway
```

## Troubleshooting Tips

-   **Container not starting/crashing:** Use `docker logs <container_name>` (e.g., `docker logs open-webui` or `docker logs bedrock-gateway`) to view container output and identify errors.
-   **"Connection refused" when accessing UI:**
    -   Check if the container is running: `docker ps`
    -   Verify firewall rules: `sudo ufw status` (ensure ports 3000/8000 are ALLOWED)
    -   Ensure the correct IP address/port is used in the browser.
-   **Bedrock models not appearing in Open WebUI:**
    -   Double-check AWS Bedrock model access in the AWS console (Step 7).
    -   Verify the Bedrock Access Gateway is running and accessible (`http://your-server-ip:8000/docs`).
    -   Ensure the connection URL and password in Open WebUI are correct (Step 8).
    -   Check Bedrock Access Gateway logs for any AWS authentication or API errors: `docker logs bedrock-gateway`.

## Conclusion

**Congratulations!** You’ve successfully set up a powerful AI environment on your server, integrating Open WebUI with AWS Bedrock via the Bedrock Access Gateway. You can now explore various Bedrock models through Open WebUI. Remember to keep your setup secure and updated for the best performance and protection.

Cheers 🍻
