FROM node:24-alpine
WORKDIR /app
COPY gate.mjs ./
# Learned picture sizes live in a volume at /data; owned by node so it can write.
RUN mkdir /data && chown node:node /data
USER node
CMD ["node", "gate.mjs"]
