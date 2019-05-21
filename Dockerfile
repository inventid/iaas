FROM node:8.15-jessie
MAINTAINER Rogier Slag

RUN apt-get update && \
    apt-get install -y imagemagick libpq-dev webp libwebp-dev && \
    apt-get autoremove -y && \
    apt-get clean

RUN yarn global add pm2 babel-cli babel-preset-es2015 babel-preset-stage-3

# Export the database, originals dir and the config dir
RUN mkdir /opt/iaas
RUN mkdir /opt/iaas/migrations
RUN mkdir /opt/iaas/config
RUN mkdir /opt/images
VOLUME ["/opt/images", "/opt/iaas/config"]

EXPOSE 1337

# Add the dependencies
ADD .babelrc /opt/iaas/
ADD yarn.lock /opt/iaas/yarn.lock
ADD package.json /opt/iaas/package.json
RUN cd /opt/iaas && yarn install --pure-lockfile

# Add the application
ADD src/*.js /opt/iaas/src/
ADD src/metrics/*.js /opt/iaas/src/metrics/
ADD src/databases/*.js /opt/iaas/src/databases/
ADD db-migrations /opt/iaas/db-migrations/
ADD src/migrations /opt/iaas/src/migrations/
RUN cd /opt/iaas/src && babel -d ../ *.js
RUN cd /opt/iaas/src/migrations && babel -d ../../migrations *.js
RUN cd /opt/iaas/src/metrics && babel -d ../../metrics *.js
RUN cd /opt/iaas/src/databases && babel -d ../../databases *.js

# Dump the image magick version for clarity
RUN convert -version

# Run the entire thing!
WORKDIR /opt/iaas
CMD ["/usr/local/bin/pm2", "start", "index.js", "--no-daemon", "--instances=max", "--exp-backoff-restart-delay=100"]
