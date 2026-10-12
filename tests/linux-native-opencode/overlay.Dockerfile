# TEST ONLY diagnostic replay of a CI artifact; NOT clean-install proof.
# candidate is a named Docker build context containing the downloaded artifact.
ARG FIXTURE_IMAGE
FROM ${FIXTURE_IMAGE}
USER root
COPY tests/linux-native-opencode/tools/package-lock.json /tmp/v2-replay-lock.json
# A cached descendant may have selected V1 for a separate compatibility probe.
# Bind this V2 replay to the unchanged locked V2 installation explicitly.
RUN cmp /tmp/v2-replay-lock.json /opt/opencode-fixture/package-lock.json && \
    ln -sfn /opt/opencode-fixture/node_modules/.bin/opencode /usr/local/bin/opencode && \
    test "$(opencode --version)" = 'opencode v2.0.22'
ARG SOURCE_COMMIT
ARG DEB_SHA256
ARG DEB_FILE
COPY --from=candidate /TEST-ONLY.txt /tmp/native-candidate-source.txt
COPY --from=candidate ${DEB_FILE} /tmp/native-v2-candidate.deb
RUN test "${#SOURCE_COMMIT}" = 40 && test "${#DEB_SHA256}" = 64 && \
    (grep -Fx "Source: $SOURCE_COMMIT" /tmp/native-candidate-source.txt || \
      { echo 'FAIL: candidate source does not match requested SHA'; exit 1; }) && \
    printf '%s  /tmp/native-v2-candidate.deb\n' "$DEB_SHA256" | sha256sum -c - && \
    dpkg -i /tmp/native-v2-candidate.deb && \
    ldd /usr/bin/agent-network-desktop >/tmp/native-candidate-linkage.txt && \
    ! grep -F 'not found' /tmp/native-candidate-linkage.txt
ENV TEST_DEB_SOURCE_COMMIT=$SOURCE_COMMIT TEST_DEB_SHA256=$DEB_SHA256
COPY tests/linux-native-daemon-ui/ui.sh /fixture/daemon-ui.sh
COPY tests/linux-native-daemon-ui/verify.py /fixture/daemon-ui-verify.py
COPY tests/linux-native-opencode/prepare.py /fixture/opencode-prepare.py
COPY tests/linux-native-opencode/create-ui.sh /fixture/opencode-create-ui.sh
COPY tests/linux-native-opencode/verify-create.py /fixture/opencode-verify-create.py
COPY tests/linux-native-opencode/lifecycle-ui.sh /fixture/opencode-lifecycle-ui.sh
COPY tests/linux-native-opencode/verify-lifecycle.py /fixture/opencode-verify-lifecycle.py
RUN bash -n /fixture/opencode-lifecycle-ui.sh && \
    python3 -c 'import ast,pathlib; ast.parse(pathlib.Path("/fixture/opencode-verify-lifecycle.py").read_text())'
RUN bash -n /fixture/opencode-create-ui.sh && \
    python3 -c 'import ast,pathlib; ast.parse(pathlib.Path("/fixture/opencode-verify-create.py").read_text())'
USER smoke
CMD ["sh", "/fixture/keyring.sh", "xvfb-run", "-a", "-s", "-screen 0 1280x900x24 -nolisten tcp", "bash", "/fixture/opencode-create-ui.sh"]
