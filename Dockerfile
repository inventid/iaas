FROM node:5.3
MAINTAINER Rogier Slag

RUN apt-get update && \
    apt-get install -y imagemagick && \
    apt-get autoremove -y && \
    apt-get clean

RUN npm install -g babel-cli babel-preset-es2015

# Export the database, originals dir and the config dir
RUN mkdir /opt/live-image-resize
RUN mkdir /opt/live-image-resize/migrations
RUN mkdir /opt/live-image-resize/config
RUN mkdir /opt/images
VOLUME ["/opt/images", "/opt/live-image-resize/config"]

EXPOSE 1337

# Add the dependencies
ADD .babelrc /opt/live-image-resize/
ADD package.json /opt/live-image-resize/package.json
RUN cd /opt/live-image-resize && npm install

# Add the application
ADD *.js /opt/live-image-resize/src/
ADD migrations /opt/live-image-resize/migrations/
RUN cd /opt/live-image-resize/src && babel -d ../ *.js

# Run the entire thing!
WORKDIR /opt/live-image-resize
CMD ["node", "index.js"]

