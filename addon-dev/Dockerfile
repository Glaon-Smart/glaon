ARG BUILD_FROM
# hadolint ignore=DL3006
FROM ${BUILD_FROM}

ENV LANG=C.UTF-8

# Dev add-on (#607). The whole job of this image is:
#
#   1. Serve the apps/web bundle on Ingress port 8099 (same packaging story
#      as production addon/).
#   2. Reverse-proxy /api/hassio/network/* to http://supervisor/network/*
#      with the SUPERVISOR_TOKEN injected as Authorization: Bearer.
#
# No Node, no apps/api, no agent — keeps the image small + the surface
# narrow. The wizard's apply step is the only flow exercised against this
# add-on; everything else in the wizard talks to the hosted apps/api over
# HTTPS like every other Glaon client (see ADR 0026).
#
# `gettext` is included for `envsubst` — run.sh uses it to substitute
# $SUPERVISOR_TOKEN into the nginx config at boot. The token is
# Supervisor-injected at container start so we can't bake it into the
# image; envsubst-at-boot is the simplest path.
# hadolint ignore=DL3018
RUN apk add --no-cache nginx gettext

COPY rootfs /
COPY dist /var/www/glaon

RUN chmod a+x /run.sh

EXPOSE 8099

CMD ["/run.sh"]
