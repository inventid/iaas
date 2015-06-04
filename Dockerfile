FROM ubuntu:14.04.2
MAINTAINER Rogier Slag

# Make the machine up to date and install some dependencies
RUN apt-get install -y software-properties-common python && \
    add-apt-repository ppa:chris-lea/node.js && \
    apt-get remove -y software-properties-common python && \
    apt-get autoremove -y
RUN echo "deb http://us.archive.ubuntu.com/ubuntu/ precise universe" >> /etc/apt/sources.list
RUN apt-get update && \
    apt-get install -y imagemagick build-essential sqlite3 make gcc nodejs && \
    apt-get autoremove -y

# Add the application
ADD resize.js /opt/live-image-resize/resize.js
ADD package.json /opt/live-image-resize/package.json

# Export the database, originals dir and the config dir
RUN mkdir /opt/live-image-resize/config
RUN mkdir /opt/images
RUN mkdir /opt/db
RUN chmod 0777 /opt/db
VOLUME ["/opt/db", "/opt/images", "/opt/live-image-resize/config"]
EXPOSE 1337

# Set the correct version of node as the default
RUN cd /opt/live-image-resize && npm install

# Decrease the file size a bit
RUN apt-get clean

# Run the entire thing!
WORKDIR /opt/live-image-resize
CMD ["/usr/bin/node", "resize.js"]

