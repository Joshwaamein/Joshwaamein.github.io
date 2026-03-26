---
layout: post
title: "ESP32 Email Notification on State Change to trigger IFS ERP Report"
date: 2024-01-23
categories: ["Code", "Homelab"]
tags: ["esp32", "arduino", "smtp", "iot", "erp"]
description: "One of the smaller projects which I particularly enjoyed enabled a fire alarm system to interact with the organisations ERP system. This was an integration project where a business stakeholder wanted "
---

Ever had one of those projects where hardware meets software meets enterprise systems and it all just *clicks*? This was one of those for me — a super fun integration project that wired up a physical fire alarm relay to an IFS ERP system using nothing more than an ESP32, a local mail server, and a bit of creative plumbing. It's the kind of thing that sounds simple on paper but feels incredibly satisfying when you see it work end to end. Let me walk you through it!

## The Brief

One of the smaller projects which I particularly enjoyed enabled a fire alarm system to interact with the organisation's ERP system. This was an integration project where a business stakeholder wanted to integrate a fire alarm system trigger with the IFS ERP system.

## The Hardware

The project used an ESP32 microcontroller along with a state change provided by the fire system's relay.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/01/esp32-pinout-chip-esp-wroom-32.webp?w=828)

## How It All Fits Together

So how does a tiny microcontroller end up triggering a full-blown ERP report? Here's the flow:

The ESP32, when sensing a state change, sent an email (using a local mail server) to the ERP system's mailbox, which was then used as a trigger to generate and send a report of all personnel on site to a distribution list for all managers to receive via a 365 mail account.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/01/blank-diagram.png?w=1020)

## The SQL Report

With the integration pipeline in place, the next piece of the puzzle was the report itself. IFS was configured with an SQL report that looked at the employee clockings to evaluate who was currently clocked in.

Here is the SQL:

```sql
select cpa.area_code as Evac, cpa.employee_name, case when tt.timrep_transaction_type_db = 'I' then 'In' when tt.timrep_transaction_type_db = 'U' then 'Out' end as Stat, tt.reg_stamp as Last_Clocking, co.org_name as department

from  COMPANY_PERSON_ALL CPA, COMPANY_ORG3 CO,TIMREP_TRANSACTION TT

left join absence_details ad on (ad.emp_no = tt.emp_no and trunc(sysdate) between to_date(ad.date_from, 'DD-MM-YY') and to_date(ad.date_to, 'DD-MM-YY'))

where (tt.trans_created =

(SELECT MAX(trans_created) FROM timrep_transaction

WHERE tt.emp_no = emp_no))

and tt.emp_no = cpa.emp_no
and tt.org_code = co.org_code
and tt.timrep_transaction_type_db = 'I'
and tt.reg_stamp >= sysdate -7
order by cpa.area_code, tt.org_code,cpa.employee_name
```

## Configuring the IFS Custom Event

Once the report was ready, I needed a way to fire it off automatically. With the help of a support partner, I created a custom event to send the email out. Here's a high-level overview of how to add the event:

1.  Navigate to the **Events** page in IFS 10 and click on **New Custom Event**.
2.  Fill in the required fields such as **Event Name**, **Event Description**, and **Event Type**.
3.  In the **Attributes** section, add the required attributes for the event.
4.  In the **Actions** section, click on **New Event Action**.
5.  Select **\*EVENT NAME\*** as the event and **Email** as the action type.
6.  Fill in the required fields such as **Action Description**, **To**, **Subject**, and **Body**.

## Testing and Deployment

The solution was tested with business stakeholders to ensure that it worked to its designed specification without error and for all users. Following approval, the solution was deployed successfully.

## The Code

The code was sourced from another resource and adapted to meet the specifications of the client. The source repository can be found here: [https://randomnerdtutorials.com/esp32-door-status-monitor-email/](https://randomnerdtutorials.com/esp32-door-status-monitor-email/)

The code for this project can be found below the breakdown.

**Here's a breakdown of what the code does:**

**1\. Connects to Wi-Fi:**

-   It establishes a connection to a specified Wi-Fi network using the provided credentials.

**2\. Sets up SMTP for email:**

-   It configures parameters for sending emails using SMTP (Simple Mail Transfer Protocol).
-   It includes settings for the SMTP server, authentication credentials, and a callback function to handle email sending results.

**3\. Monitors a door sensor:**

-   It uses a state change (emulated by a reed switch) connected to a specific GPIO pin to detect the opening and closing of a door.
-   It employs an interrupt mechanism to trigger a function whenever the reed switch changes state.

**4\. Sends an email when the door is opened:**

-   When the code detects that the door has been opened:
    -   It creates an email message with the subject "SUBJECT GOES HERE" and the body indicating the door state as "open."
    -   It sends the email to a designated recipient using the configured SMTP settings.

**5\. Additional features:**

-   It includes a delay mechanism to avoid sending multiple emails for a single door opening event.
-   It controls an LED to visually indicate the door state (lit when open, unlit when closed).
-   It prints debug information to the serial console for troubleshooting purposes.

**Key points:**

-   The code is intended for use in a fire safety or security system.
-   It's designed to run on an ESP32 microcontroller (based on the libraries used).
-   It requires specific Wi-Fi credentials, SMTP server information, and email account details to function.
-   It employs hardware components like a reed switch and LED.

```cpp
#include <WiFi.h>#include <Arduino.h>#include <ESP_Mail_Client.h>/* WIFI */#define WIFI_SSID "SSID NAME GOES HERE"#define WIFI_PASSWORD "PASSPHRASE GOES HERE"#define SMTP_HOST "SMTP HOST ADDRESS GOES HERE"#define SMTP_PORT 465/* The sign in credentials */#define AUTHOR_EMAIL "EMAIL ADDRESS GOES HERE"#define AUTHOR_PASSWORD "EMAIL PASSWORD GOES HERE"/* Recipient's email*/#define RECIPIENT_EMAIL "RECIPIENT EMAIL ADDRESS GOES HERE"/* Set GPIOs for LED and reedswitch */#define REED_SWITCH 4#define LED 2#define INTERVAL 1000/* The SMTP Session object used for Email sending */SMTPSession smtp;/* Detects whenever the door changed state */bool changeState = false;// Holds reedswitch state (1=opened, 0=close)bool state;String doorState;// Auxiliary variables (it will only detect changes that are 1500 milliseconds apart)unsigned long previousMillis = 1500;/* Callback after the message has been sent */void smtpCallback(SMTP_Status status){    /* Print the current status */    Serial.println(status.info());    /* Print the sending result */    if (status.success())    {        Serial.println("----------------");        ESP_MAIL_PRINTF("Message sent success: %d\n", status.completedCount());        ESP_MAIL_PRINTF("Message sent failled: %d\n", status.failedCount());        Serial.println("----------------\n");        struct tm dt;        for (size_t i = 0; i < smtp.sendingResult.size(); i++)        {            /* Get the result item */            SMTP_Result result = smtp.sendingResult.getItem(i);            time_t ts = (time_t)result.timestamp;            localtime_r(&ts, &dt);            ESP_MAIL_PRINTF("Message No: %d\n", i + 1);            ESP_MAIL_PRINTF("Status: %s\n", result.completed ? "success" : "failed");            ESP_MAIL_PRINTF("Date/Time: %d/%d/%d %d:%d:%d\n", dt.tm_year + 1900, dt.tm_mon + 1, dt.tm_mday, dt.tm_hour, dt.tm_min, dt.tm_sec);            ESP_MAIL_PRINTF("Recipient: %s\n", result.recipients);            ESP_MAIL_PRINTF("Subject: %s\n", result.subject);        }        Serial.println("----------------\n");    }}void connectToWiFi(){    Serial.println();    Serial.print("Connecting to AP");    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);    while (WiFi.status() != WL_CONNECTED)    {        Serial.print(".");        delay(200);    }    Serial.println("");    Serial.println("WiFi connected.");    Serial.println("IP address: ");    Serial.println(WiFi.localIP());    Serial.println();}void setupSMTP(){    /** Enable the debug via Serial port     * none debug or 0     * basic debug or 1     */    smtp.debug(1);    /* Set the callback function to get the sending results */    smtp.callback(smtpCallback);}ESP_Mail_Session createSMTPMailSession(){    ESP_Mail_Session session;    session.server.host_name = SMTP_HOST;    session.server.port = SMTP_PORT;    session.login.email = AUTHOR_EMAIL;    session.login.password = AUTHOR_PASSWORD;    session.login.user_domain = "";    return session;}SMTP_Message createSMTPMessage(){    SMTP_Message message;    /* Set the message headers */    message.sender.name = "NAME HEADER GOES HERE";    message.sender.email = AUTHOR_EMAIL;    message.subject = "SUBJECT GOES HERE";    message.addRecipient("NAME", RECIPIENT_EMAIL);    /*Send HTML message*/    String htmlMsg = "<div style=\"color:#2f4468;\"><h1>Fire Alarm Trip</h1><p>" + doorState + "</ p></ div> ";    message.html.content = htmlMsg.c_str();    message.text.charSet = "us-ascii";    message.html.transfer_encoding = Content_Transfer_Encoding::enc_7bit;    return message;}void sendMessage(ESP_Mail_Session session, SMTP_Message message){    /* Connect to server with the session config */    if (!smtp.connect(&session))        return;    /* Start sending Email and close the session */    if (!MailClient.sendMail(&smtp, &message))        Serial.println("Error sending Email, " + smtp.errorReason());}void sendEmail(){    ESP_Mail_Session session = createSMTPMailSession();    SMTP_Message message = createSMTPMessage();    sendMessage(session, message);}// Runs whenever the reedswitch changes stateICACHE_RAM_ATTR void changeDoorStatus(){    changeState = true;}void setupDoorMonitor(){    pinMode(REED_SWITCH, INPUT_PULLUP);    state = digitalRead(REED_SWITCH);    // Set LED state to match door state    pinMode(LED, OUTPUT);    digitalWrite(LED, !state);    // Set the reedswitch pin as interrupt, assign interrupt function and set CHANGE mode    attachInterrupt(digitalPinToInterrupt(REED_SWITCH), changeDoorStatus, CHANGE);}bool isPastInterval(){    unsigned long currentMillis = millis();    if (currentMillis - previousMillis >= INTERVAL)    {        previousMillis = currentMillis;        return true;    }    return false;}void invertDoorState(){    state = !state;    if (state)    {        doorState = "closed";    }    else    {        doorState = "open";    }}void setup(){    Serial.begin(115200);    connectToWiFi();    setupSMTP();    setupDoorMonitor();}void loop(){    if (changeState && isPastInterval())    {        // If a state has occured, invert the current door state        invertDoorState();        digitalWrite(LED, !state);        changeState = false;        Serial.println(state);        Serial.println(doorState);        //true is open false is closed//        if (state == false) {          sendEmail();        }    }}
```

## Wrapping Up

This was a really rewarding project that brought together IoT hardware, email infrastructure, and enterprise ERP systems into one neat package. It's a great example of how a cheap microcontroller like the ESP32 can bridge the gap between the physical world and complex business systems. If you're looking to do something similar, I hope this gives you a solid starting point!

Cheers 🍻
