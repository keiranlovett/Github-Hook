FROM node:alpine

MAINTAINER KEIRAN LOVETT <kvclovett@gmail.com>
LABEL org.opencontainers.image.description "Automatically inject new Gitlab Projects repository with a customisable content."
LABEL org.opencontainers.image.source="https://github.com/keiranlovett/Gitlab-Server-Hook"

WORKDIR /app

COPY package.json package-lock.json ./
COPY app.js /app/
COPY events /app/events

RUN npm install

# Set the "config" folder as a mountable volume
VOLUME ["./config"]

ENTRYPOINT ["node", "app.js"]