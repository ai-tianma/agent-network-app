# Only the current public pair plus real native V1 creation. No candidate overlay.
ARG V1_MODEL_IMAGE
FROM ${V1_MODEL_IMAGE}
USER root
# Disposable Ubuntu useradd has no login manager to create the normal private
# runtime base. Keep the published OpenCode gate; supply its OS prerequisite.
RUN install -d -o smoke -g smoke -m 0700 /run/user/10001
COPY tests/linux-native-current-v1/manifest.json /fixture/public-pair.json
COPY tests/linux-native-current-v1/prepare.py /fixture/current-pair-prepare.py
ENV TEST_DAEMON_PREFIX_PREPARE=/fixture/current-pair-prepare.py
USER smoke
