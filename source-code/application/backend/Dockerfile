FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y gcc g++ curl && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p /opt/adbc-driver && \
    curl -fsSL -o /opt/adbc-driver/libadbc_driver_vastdb.so \
      "https://artifactory.vastdata.com/files/vastdb-native-client/1955131/libadbc_driver_vastdb.so" && \
    chmod 755 /opt/adbc-driver/libadbc_driver_vastdb.so

COPY src/ ./src/

ENV PYTHONUNBUFFERED=1

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
