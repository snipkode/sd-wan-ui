FROM ubuntu:26.04

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libgomp1 unzip \
    && rm -rf /var/lib/apt/lists/*

ARG SD_ZIP_URL=https://github.com/leejet/stable-diffusion.cpp/releases/download/master-1106-532d2c1/sd-master-532d2c1-bin-Linux-Ubuntu-26.04-x86_64.zip

ADD ${SD_ZIP_URL} /tmp/sd.zip
RUN mkdir -p /sd.cpp/bin \
    && unzip -o /tmp/sd.zip -d /sd.cpp/bin \
    && rm /tmp/sd.zip \
    && chmod +x /sd.cpp/bin/*

WORKDIR /sd.cpp/bin
ENTRYPOINT ["/sd.cpp/bin/sd-cli"]
