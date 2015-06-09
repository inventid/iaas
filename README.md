# Live Image Resize

[![Docker downloads](https://img.shields.io/docker/pulls/rogierslag/live-image-resize.svg)](https://registry.hub.docker.com/u/rogierslag/live-image-resize/)
[![GitHub license](https://img.shields.io/github/license/mashape/apistatus.svg)](https://github.com/inventid/live-image-resize/blob/master/LICENSE)

## What is it?

The need to show user generated content is growing on the web.
However, different clients (mobile apps, or a web client) might need these images in other resolutions.
Converting these every single time is time-consuming and inefficient.

Therefore this live image resizer, a joint project between [inventid](https://www.inventid.nl) and [Magnet.me](https://magnet.me), attempts to circumvent these issues.

## How does it work?

A client can simply request an image, and specify the maximum height, width, and a format (e.g. `/sfsdf_1040_1040.png`).
To support Apple's retina solution, this can be suffixed with an upscale parameter, e.g. `/sfsdf_1040_1040_2x.png` (but also `_13x` for future use).
A quick check is made whether this image was previously scaled to that resolution.

If yes, a redirect is given to the cache location of that image (currently AWS S3).
Otherwise the image is resized live, and served directly to the client, the cached version is uploaded to AWS S3.

Adding images is equally simple.
A client can simply post an image, accompanied by a token.
These tokens can be requested from a `POST` on `/token` (which you should firewall to certain IP's).
That token is then valid once, so your client can upload the file directly, without having it to go through your own application (except for the identifier probably).

Logging takes place in a JSON Logstash enabled format, so it's easy to get into Logstash and Kibana. Great for logging!

## How to use

### Requesting an image

You can simply request an image using a plain GET request to `http://localhost:2337/example_100_100.png`.
This will trigger the server to search for the image with id `example`, and serve it in a PNG format in a `100x100` resolution.
Depending on earlier requests, the image might be on the CDN (causing a redirect) or be transcoded on the fly and uploaded later.
For Retina (or HiDpi) displays, the postfix `_2x` will appropriately resize the image to that size (or perform a redirect).

### Uploading images

In order to upload an image, you need to do a POST request to `/token`.
This post has an payload of an id in json.
This endpoint should generally be filtered out by your firewall or loadbalancer.
The received token is valid for 15 minutes.
The client can then directly use this token to upload a file.

An example command in curl is `curl -vvv -XPOST http://localhost:1337/token -d '{"id": "test"}' -H "Content-Type: application/json"`

The client uses another `POST` request to `http://localhost:2337/someimage.jpg`, this will cause the `someimage` key to be used.
A token also should be send along, this is done in the HTTP-Headers in the `X-Token` parameter.
The token will automatically expire once used.
The token is only valid for one upload attempt and one id.

An example command in curl is `curl -vvv -XPOST http://localhost:1337/test.jpg -H "X-Token: earlier-return-value" -F "image=@/home/user1/Desktop/test.jpg"`

## Configuration

### Settings

You need to copy the `default.json.example` to `default.json` in the `config` directory.
Then, specify your own values.

In case you like to use it in production, call the script like this:

````bash
export NODE_ENV=production
node rewrite.js
````

It will then additionally load the `production.json` file.

### Database

To keep the cache links, an additional SQLite database is used.
On first run, simple first call `node prepare.js` to create the database.

### Originals

For quick saving, the original files are kept in `images` subdirectory (retrieving from AWS S3 is too slow).
Be sure to keep this data and backup it.
You can also use the config to let it point to another directory.
In that case, ensure the user can write there!

## Contributing

We have created a [Vagrant](http://vagrantup.com) image available which is ready to use for development.
Simply install Vagrant, run `vagrant up`, `vagrant ssh`, and `cd /vagrant`.
Here you can run the server using `node resize.js`.

If you have additions for the code, please [fork the repo](https://github.com/inventid/live-image-resize/fork) and open a Pull Request.

