#!/bin/bash

echo "Updating apt-get index"
apt-get update > /dev/null 2>&1

echo "Upgrading all current packages"
apt-get upgrade -y > /dev/null 2>&1

echo "Installing new packages"
apt-get install git curl unzip imagemagick build-essential sqlite3 -y > /dev/null 2>&1

echo "Installing node"
git clone git://github.com/creationix/nvm.git /opt/nvm >> /tmp/provision.log 2>&1
. /opt/nvm/nvm.sh >> /tmp/provision.log 2>&1
nvm install 0.10 >> /tmp/provision.log 2>&1

echo "Installing npm"
npm install -g aws-sdk gm sqlite3 >> /tmp/provision.log 2>&1

echo "Setting Node default"
echo ". /opt/nvm/nvm.sh" > /home/vagrant/.bash_login
echo "nvm use 0.10" >> /home/vagrant/.bash_login

echo " " 
echo "And remember: always enjoy open source ;)"

echo " "
echo "Provisioning finished"
echo "run 'vagrant ssh' to enter the machine, then 'cd /vagrant'"
