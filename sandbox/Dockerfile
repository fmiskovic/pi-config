# pi in a container that only sees the directory you start it from.
# Built and run by ./pi-sandbox; see the README for what it isolates.

ARG GO_VERSION=1.27
FROM golang:${GO_VERSION}-bookworm AS go

FROM node:24-bookworm-slim

ARG PI_VERSION=latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git ripgrep \
  && rm -rf /var/lib/apt/lists/*

COPY --from=go /usr/local/go /usr/local/go

RUN npm install -g --ignore-scripts "@earendil-works/pi-coding-agent@${PI_VERSION}" \
  && npm cache clean --force

# Run as the image's unprivileged user. Pre-create the directories that become
# volumes so Docker gives them this user's ownership.
RUN mkdir -p /home/node/.pi/agent /home/node/go /workspace \
  && chown -R node:node /home/node /workspace

USER node
ENV PATH=/usr/local/go/bin:/home/node/go/bin:$PATH \
    GOPATH=/home/node/go

WORKDIR /workspace
ENTRYPOINT ["pi"]
