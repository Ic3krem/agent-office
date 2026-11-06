# Agent Office party server: zero dependencies, runs as the unprivileged node user, nothing written to disk.
FROM node:24-alpine
WORKDIR /party
COPY protocol.mjs server.mjs ./
USER node
ENV PARTY_PORT=4880
EXPOSE 4880
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:4880/health || exit 1
CMD ["node", "server.mjs"]
