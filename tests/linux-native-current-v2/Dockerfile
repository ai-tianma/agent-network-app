# TEST ONLY. Reuse unchanged public170/136 software, never a candidate overlay.
ARG V2_NATIVE_IMAGE
FROM ${V2_NATIVE_IMAGE}
USER root
COPY tests/linux-native-current-v1/manifest.json /fixture/public-pair.json
COPY tests/linux-native-current-v1/prepare.py /fixture/current-pair-prepare.py
ENV TEST_DAEMON_PREFIX_PREPARE=/fixture/current-pair-prepare.py TEST_CURRENT_V2_UI=1
USER smoke
