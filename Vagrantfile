# -*- mode: ruby -*-
# vi: set ft=ruby :

require 'json'

# Vagrantfile API/syntax version. Don't touch unless you know what you're doing!
VAGRANTFILE_API_VERSION = "2"

vagrantConfigFile = "vagrantConfig.json"

if File.exists?(vagrantConfigFile)
  userConfig = JSON.parse(File.read(vagrantConfigFile))
else
  userConfig = {}
end

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box     = "ubuntu/trusty64"
  config.vm.provider :virtualbox do |vb|
      vb.name = "live-image-resize-local.inventid.net"
  end

  config.vm.network :forwarded_port, guest: 1337, host: 2337

  memory = userConfig["memory"] || 512
  cpus = userConfig["cpus"] || 1

  config.vm.provider :virtualbox do |vb|
    vb.customize ["modifyvm", :id, "--memory", memory, "--cpus", cpus]
  end

  config.vm.hostname = "live-image-resize-local.inventid.net"
  config.vm.provision :shell, :path => "provision.sh"

end

