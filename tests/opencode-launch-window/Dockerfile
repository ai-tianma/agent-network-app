FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4
# TEST ONLY: actual source functions, held at the pre-exec boundary.
ADD https://github.com/sleep2agi/agent-network/archive/edc68a4ca87bbb7ca4944093e8ff113a17078624.tar.gz /tmp/source.tgz
RUN mkdir /source && tar -xzf /tmp/source.tgz -C /source --strip-components=1
COPY tests/opencode-launch-window/ /fixture/
USER bun
CMD ["bun", "/fixture/probe.ts"]
