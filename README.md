# Live Image Resize

## What is it?

The need to show user generated content is growing on the web.
However, different clients (mobile apps, or a webclient) might need these images in other resolutions.
Converting these every single time is time-consuming and inefficient.

Therefore this live image resizer, a joing project between [inventid](https://www.inventid.nl) and [Magnet.me](https://magnet.me), attempts to circumvent these issues.

## How does it work?

A client can simply request an image, and specify the maximum height, width, and a format (e.g. `/sfsdf_1040_1040.png`).
To support Apple's retina solution, this can be postfixed with an upscale parameter, e.g. `/sfsdf_1040_1040_2x.png` (but also `_13x` for future use).
A quick check is made whether this image was previously scaled to that resolution.

If yes, a redirect is given to the cache location of that image (currently AWS S3).
Otherwise the image is resized live, and served directly to the client, the cached version is uploaded to AWS S3.

Adding images is equally simple.
A client can simply post an image, accompanied by a token.
These tokens can be requested from a `POST` on `/token` (which you should firewall to certain IP's).
That token is then valid once, so your client can upload the file directly, without having it to go through your own application (except for the identifier probably).

Logging takes place in a JSON Logstash enabled format, so it's easy to get into Logstash and Kibana. Great for logging!

## Current state

Well, at the moment we just live generate an image. Working on it though

## Contributing

We have created a [Vagrant](http://vagrantup.com) image available which is ready to use for development.
Simply install Vagrant, run `vagrant up`, `vagrant ssh`, and `cd /vagrant`.
Here you can run the server using `node resize.js`.

If you have additions for the code, please [fork the repo](https://github.com/inventid/live-image-resize/fork) and open a Pull Request.
