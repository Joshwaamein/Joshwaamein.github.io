---
layout: post
title: "Building a Real-Time Temperature and Humidity Monitoring System with Flask, Prometheus, and Grafana"
date: 2024-05-07
categories: ["Homelab", "Code"]
tags: ["raspberry-pi", "python", "prometheus", "grafana", "monitoring", "iot"]
description: "Learn how to build a real-time temperature and humidity monitoring system using a DHT22 sensor, Raspberry Pi, Flask, Prometheus, and Grafana. This project demonstrates data collection, metric exposure"
---

In this project, we’ll explore how to build a real-time monitoring system for temperature and humidity using a DHT22 sensor, a Raspberry Pi, and a combination of powerful tools: Flask, Prometheus, and Grafana. By the end of this post, you’ll have a working system that collects data, exposes it for monitoring, and visualises it on a sleek dashboard. You can use this to monitor the temperature and humidity (and more) of any location with networking and power!

**What You’ll Need**  
A Raspberry Pi (any model with GPIO support)  
DHT22 temperature and humidity sensor  
Python environment  
Flask for creating a web application  
Prometheus for monitoring and alerting  
Grafana for visualisation

Here’s a sneak peek of the final product which is customisable to your desire with extra data and dashboards! Check out the extra steps at the bottom of this post to find out how to add weather data via an API call to OpenWeather!

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image-20.png?w=1024)

## First Trial

To check if the sensor worked as expected, I decided to first run it using an ESP32 microcontroller.

I wired up the 3.3v, GND and GPIO as shown below:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/img_7906.jpg?w=768)

Firstly, start by installing Arduino IDE on your machine to write, edit, and flash a sketch to the ESP32-WROOM module: [https://www.arduino.cc/en/software](https://www.arduino.cc/en/software)

Then run the software and install the ESP32 board library and the DHT22 sketch library by Adafruit. A tutorial on how to do this can be found here: [https://randomnerdtutorials.com/esp32-dht11-dht22-temperature-humidity-sensor-arduino-ide/](https://randomnerdtutorials.com/esp32-dht11-dht22-temperature-humidity-sensor-arduino-ide/)

Create a new sketch file with the following contents:

```cpp
#include <DHT.h>
#define DHTPIN 4      // Define the GPIO pin connected to the DATA pin of the sensor
#define DHTTYPE DHT22 // Or DHT11 if you have that version of the sensor
DHT dht(DHTPIN, DHTTYPE);
void setup() {
  Serial.begin(115200);
  dht.begin();
}
void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) {
    Serial.println("Failed to read from DHT sensor!");
    return;
  }
  Serial.print("Humidity: ");
  Serial.print(h);
  Serial.print(" %\t");
  Serial.print("Temperature: ");
  Serial.print(t);
  Serial.println(" *C");
  delay(2000); // Read data every 2 seconds
}
```

We can then upload this to the microcontroller and open the serial monitor to see the data!

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image.png?w=815)

Success!

## Moving to the Pi-4

With the sensor validated on the ESP32, it was time to move to the Raspberry Pi 4, which will serve as our permanent monitoring platform. The Pi gives us the ability to run a full Linux environment, making it easy to host Flask, Prometheus, and Grafana all on one device.

First, we connect the DHT22 sensor to the Raspberry Pi and use the `Adafruit_DHT` library to read temperature and humidity data. We’ll write a Python script to periodically collect these readings.

I started by wiring up the 3.3v, ground, and GPIO pin 2 to read data.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image-15.png?w=696)

[https://descubrearduino.com/pines-gpio-de-la-raspberry-pi-4/](https://descubrearduino.com/pines-gpio-de-la-raspberry-pi-4/)

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/img_7907.jpg?w=768)

## Ran Updates on the Pi via SSH

```bash
sudo apt update && sudo apt upgrade -y
```

## Installed Python and DHT library

```bash
sudo apt-get update
sudo apt-get install python3 python3-pip
python3 -m pip install --upgrade pip
python3 -m pip install Adafruit-DHT
```

## Created a Python script to read the sensor on pin 2

```bash
nano /home/ubuntu/temps.py
```
```python
#!/usr/bin/env python3

import Adafruit_DHT as dht_sensor
import time

def get_temperature_readings():
    humidity, temperature = dht_sensor.read_retry(dht_sensor.DHT22, 2)
    humidity = format(humidity, ".2f") + "%"
    temperature = format(temperature, ".2f") + "C"
    return {"temperature": temperature, "humidity": humidity}

while True:
    print(get_temperature_readings())
    time.sleep(2)
```

Ran the script to print to console:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image-8.png?w=435)

Success!

We can now modify this script to output to a web server which can be scraped by Prometheus to then graph in Grafana.

## Install Prometheus

Using the Prometheus documentation found here: [https://prometheus.io/docs/introduction/first\_steps/](https://prometheus.io/docs/introduction/first_steps/)

```bash
wget https://github.com/prometheus/prometheus/releases/download/v2.52.0/prometheus-2.52.0.linux-arm64.tar.gz

tar xvfz prometheus-2.52.0-rc.1.linux-arm64.tar.gz

cd prometheus-2.52.0-rc.1.linux-arm64

./prometheus --help
```

Ran the preconfigured yml to test the install

```bash
./prometheus --config.file=prometheus.yml
```

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image-6.png?w=1024)

Success!

The Prometheus web frontend also came up on localhost:9090

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image-7.png?w=1024)

We can now create a Python script to publish the system variables and sensor variables to a webpage on localhost:5000/metrics which can be read by Prometheus.

## Create Flask app in Python

Next, we create a Flask application that exposes the sensor data to Prometheus. We’ll use the `prometheus_client` library to create metrics that Prometheus can scrape.

```bash
nano /home/ubuntu/flask_temps1.py
```
```python
#!/usr/bin/env python3

from flask import Flask, Response
from prometheus_client import Gauge, generate_latest
import Adafruit_DHT as dht_sensor
import time

app = Flask(__name__)

# Create Prometheus metrics
TEMPERATURE_GAUGE = Gauge('room_temperature_celsius', 'Room Temperature in Celsius')
HUMIDITY_GAUGE = Gauge('room_humidity_percent', 'Room Humidity in Percent')

def get_temperature_readings():
    humidity, temperature = dht_sensor.read_retry(dht_sensor.DHT22, 4)
    return temperature, humidity

@app.route('/metrics')
def metrics():
    temperature, humidity = get_temperature_readings()
    if temperature is not None and humidity is not None:
        TEMPERATURE_GAUGE.set(temperature)
        HUMIDITY_GAUGE.set(humidity)
    return Response(generate_latest(), mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

This will start the Flask server on port 5000, and the /metrics endpoint will expose the temperature and humidity data.

Run the Flask application with:

```bash
python3 flask_temps1.py
```

## Configure prometheus.yml

We configure Prometheus to scrape the metrics from our Flask application by creating a `prometheus.yml` configuration file.

```bash
sudo nano /etc/prometheus/prometheus.yml
```

Comment out the contents and add:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'temperature_humidity'
    static_configs:
      - targets: ['localhost:5000']
```

We can then run the Prometheus file with:

```bash
./prometheus --config.file=prometheus.yml
```

Prometheus output will print to console when queried by Grafana later like the below:

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image-9.png?w=932)

## Install Grafana

Finally, we set up Grafana to visualise the data.

Install Grafana using the documentation on: [https://grafana.com/docs/grafana/latest/setup-grafana/installation/debian/](https://grafana.com/docs/grafana/latest/setup-grafana/installation/debian/)

```bash
sudo apt-get install -y apt-transport-https software-properties-common wget

sudo mkdir -p /etc/apt/keyrings/
wget -q -O - https://apt.grafana.com/gpg.key | gpg --dearmor | sudo tee /etc/apt/keyrings/grafana.gpg > /dev/null

echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com stable main" | sudo tee -a /etc/apt/sources.list.d/grafana.list

echo "deb [signed-by=/etc/apt/keyrings/grafana.gpg] https://apt.grafana.com beta main" | sudo tee -a /etc/apt/sources.list.d/grafana.list

# Updates the list of available packages
sudo apt-get update

# Installs the latest OSS release:
sudo apt-get install grafana

# Installs the latest Enterprise release:
sudo apt-get install grafana-enterprise
```

Grafana should now be visible on localhost:3000.

## Configure Grafana

**Add Prometheus Data Source**:

-   Open Grafana in your web browser (`http://localhost:3000` by default).
-   Log in (default credentials are `admin`/`admin`).
-   Go to **Configuration** -> **Data Sources** -> **Add data source**.
-   Select **Prometheus** and set the URL to `http://localhost:9090`.

**Create a Dashboard**:

-   Go to **Create** -> **Dashboard**.
-   Add a new panel.
-   In the **Metrics** section, use the query `room_temperature_celsius` for temperature and `room_humidity_percent` for humidity.
-   Configure the visualisations and save the dashboard.

You now have a complete setup where your temperature and humidity data is collected by Prometheus and visualised in Grafana.

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image-13.png?w=1024)

With this setup, you have a robust system for monitoring and visualising temperature and humidity in real-time. This project showcases how easy it is to integrate hardware sensors with modern monitoring and visualisation tools, making it ideal for both home automation enthusiasts and professional IoT applications.

## Adding OpenWeather API Data

When analysing your temperature data, it is useful to be able to see the weather data in your area. To do this, go to:[https://openweathermap.org/](https://openweathermap.org/) and create an account and API key. Find the coordinates for your location on Google Maps and add them to the below Python file.

```python
#!/usr/bin/env python3

from flask import Flask, Response
from prometheus_client import Gauge, generate_latest
import Adafruit_DHT as dht_sensor
import requests
import time

app = Flask(__name__)

# Create Prometheus metrics
TEMPERATURE_GAUGE = Gauge('room_temperature_celsius', 'Room Temperature in Celsius')
HUMIDITY_GAUGE = Gauge('room_humidity_percent', 'Room Humidity in Percent')
FORECAST_TEMPERATURE_GAUGE = Gauge('forecast_temperature_celsius', 'Forecast Temperature in Celsius')
FORECAST_HUMIDITY_GAUGE = Gauge('forecast_humidity_percent', 'Forecast Humidity in Percent')

# Configuration for OpenWeatherMap API
API_KEY = 'your_openweathermap_api_key'
LATITUDE = 'LATITUDE'
LONGITUDE = 'LONGITUDE'
URL = f"http://api.openweathermap.org/data/2.5/weather?lat={LATITUDE}&lon={LONGITUDE}&appid={API_KEY}&units=metric"

def get_temperature_readings():
    humidity, temperature = dht_sensor.read_retry(dht_sensor.DHT22, 2)
    return temperature, humidity

def get_forecast_readings():
    response = requests.get(URL)
    data = response.json()
    if response.status_code == 200 and 'main' in data:
        forecast_temperature = data['main']['temp']
        forecast_humidity = data['main']['humidity']
        return forecast_temperature, forecast_humidity
    else:
        return None, None

@app.route('/metrics')
def metrics():
    # Get sensor readings
    temperature, humidity = get_temperature_readings()
    if temperature is not None and humidity is not None:
        TEMPERATURE_GAUGE.set(temperature)
        HUMIDITY_GAUGE.set(humidity)

    # Get forecast readings
    forecast_temperature, forecast_humidity = get_forecast_readings()
    if forecast_temperature is not None and forecast_humidity is not None:
        FORECAST_TEMPERATURE_GAUGE.set(forecast_temperature)
        FORECAST_HUMIDITY_GAUGE.set(forecast_humidity)

    return Response(generate_latest(), mimetype='text/plain')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

Add the new data to your visualisation and you should be done!

![](https://joshuamein.wordpress.com/wp-content/uploads/2024/05/image-19.png?w=1024)

## Conclusion

This project was a great way to combine hardware tinkering with software monitoring tools. Starting from a simple ESP32 prototype to a full Raspberry Pi setup running Flask, Prometheus, and Grafana, we now have a real-time temperature and humidity monitoring system that is both powerful and extensible. Whether you want to track your room's climate, monitor a server closet, or keep an eye on a greenhouse, this stack has you covered. Feel free to expand on this by adding more sensors, alerts, or data sources like the OpenWeather API shown above.

Cheers 🍻