FROM ubuntu:14.04.2
MAINTAINER Rogier Slag

# Make the machine up to date and install some dependencies
RUN apt-get install -y software-properties-common python && \
    add-apt-repository ppa:chris-lea/node.js && \
    apt-get remove -y software-properties-common python && \
    apt-get autoremove -y && \
    apt-get clean
RUN echo "deb http://us.archive.ubuntu.com/ubuntu/ precise universe" >> /etc/apt/sources.list
RUN apt-get update && \
    apt-get install -y imagemagick build-essential sqlite3 make gcc nodejs && \
    apt-get autoremove -y && \
    apt-get clean

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
CMD ["/usr/bin/node", "resize.js"]

