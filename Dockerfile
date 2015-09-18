FROM node:latest
MAINTAINER Rogier Slag

RUN apt-get update && \
    apt-get install -y imagemagick graphicsmagick sqlite3 && \
    apt-get autoremove -y && \
    apt-get clean

RUN npm install -g pm2

# Export the database, originals dir and the config dir
RUN mkdir /opt/live-image-resize
RUN mkdir /opt/live-image-resize/config
RUN mkdir /opt/images
RUN mkdir /opt/db
RUN chmod 0777 /opt/db
VOLUME ["/opt/db", "/opt/images", "/opt/live-image-resize/config"]
EXPOSE 1337

# Add the dependencies
ADD package.json /opt/live-image-resize/package.json
RUN cd /opt/live-image-resize && npm install

# Add the application
ADD resize.js /opt/live-image-resize/resize.js

# Run the entire thing!
WORKDIR /opt/live-image-resize
CMD ["/usr/local/bin/pm2", "start", "resize.js", "--no-daemon", "--instances=1"]

