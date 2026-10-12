# TEST ONLY: candidate replay, not a clean-install or release gate.
ARG V1_IMAGE
ARG NATIVE_IMAGE
FROM ${V1_IMAGE} AS runtime
FROM ${NATIVE_IMAGE}
USER root
ARG SOURCE_COMMIT
ARG DEB_SHA256
RUN test "${#SOURCE_COMMIT}" = 40 && test "${#DEB_SHA256}" = 64 && \
    test "$TEST_DEB_SOURCE_COMMIT" = "$SOURCE_COMMIT" && \
    test "$TEST_DEB_SHA256" = "$DEB_SHA256"
COPY --from=runtime /usr/local/lib/node_modules/opencode-ai/ /usr/local/lib/node_modules/opencode-ai/
RUN ln -sfn /usr/local/lib/node_modules/opencode-ai/bin/opencode.exe /usr/local/bin/opencode && \
    test "$(opencode --version)" = 1.18.34
COPY tests/linux-native-opencode-v1/atomic.py /fixture/v1-atomic.py
COPY tests/linux-native-opencode-v1/create-ui.sh /fixture/v1-create-ui.sh
COPY tests/linux-native-opencode-v1/verify.py /fixture/v1-verify.py
COPY tests/linux-native-opencode-v1/reachability.py /fixture/v1-reachability.py
RUN bash -n /fixture/v1-create-ui.sh && python3 -c 'import ast,pathlib; [ast.parse(p.read_text()) for p in pathlib.Path("/fixture").glob("v1-*.py")]'
USER smoke
CMD ["python3", "/fixture/v1-atomic.py"]
