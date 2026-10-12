FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
# TEST ONLY: compare shipped bytes with an exact GitHub main ancestor.
ADD --checksum=sha256:ef9ed47cff0a1d6b65ef100dbf684f4e2c430e802ee75809bdb4db3c62fc6e54 https://registry.npmjs.org/@sleep2agi/commhub-server/-/commhub-server-0.9.0-preview.127.tgz /tmp/hub.tgz
ADD --checksum=sha256:dc84654c67487474f630dbb867cfee46f1d35ddb350a7fa6a3dd82394afd71cd https://github.com/sleep2agi/agent-network/archive/31b0dbdae3192f471c8812574c118795658120f0.tar.gz /tmp/source.tgz
RUN mkdir /candidate /source && tar -xzf /tmp/hub.tgz -C /candidate --strip-components=1 && tar -xzf /tmp/source.tgz -C /source --strip-components=1
COPY tests/bundled-hub-provenance/probe.mjs /probe.mjs
USER bun
CMD ["bun", "/probe.mjs"]
