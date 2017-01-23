# Live Image Resize

[![Code Climate](https://codeclimate.com/github/inventid/iaas/badges/gpa.svg)](https://codeclimate.com/github/inventid/iaas)
[![Dependency Status](https://gemnasium.com/inventid/iaas.svg)](https://gemnasium.com/inventid/iaas)

[![Docker downloads](https://img.shields.io/docker/pulls/inventid/iaas.svg)](https://registry.hub.docker.com/u/inventid/iaas/)
[![GitHub license](https://img.shields.io/github/license/inventid/iaas.svg)](https://github.com/inventid/iaas/blob/master/LICENSE)

## What is it?

The need to show user generated content is growing on the web.
However, different clients (mobile apps, or a web client) might need these images in other resolutions.
Converting these every single time is time-consuming and inefficient.

Therefore we present iaas, Imaging-As-A-Service, a joint project between [inventid](https://www.inventid.nl) and [Magnet.me](https://magnet.me).

## How does it work?

### Requesting

A client can simply request an image, and specify the maximum height, width, and a format (e.g. `/sfsdf_1040_1040.png`).
To support Apple's retina solution, this can be suffixed with an upscale parameter, e.g. `/sfsdf_1040_1040_2x.png` (but also `_13x` for future use).
A quick check is made whether this image was previously scaled to that resolution.

If yes, a redirect is given to the cache location of that image (currently AWS S3).
Otherwise the image is resized live, and served directly to the client, while a new cached version is uploaded to AWS S3.

The resize honours the aspect ratio, hence the image is scaled to the maximum size given in the boundary box (which is in the request).

### Uploading

Adding images is equally simple.
A client can simply post an image, accompanied by a token.
These tokens can be requested from a `POST` on `/token` (which you should firewall to certain IP's).
That token is then valid once, so your client can upload the file directly, without having it to go through your own application (except for the identifier probably).

Logging takes place in a JSON Logstash enabled format, so it's easy to get into Logstash and Kibana. Great for logging!

### Options

Additional options can be given when requesting or uploading images.
All options for requesting are chainable.

| Option | Usage | Effect |
|---|---|---|
| Originals | GET `/example.jpg` | The original image is served. No blurring or cropping will be applied |
| Cropping | GET `/example_100_100.jpg?fit=crop` | The image is cropped to the resolution, the result is an exact match for the resolution. Images are cropped to the center. |
| Canvas | GET `/example_100_100.jpg?fit=canvas` | The image is resized as normally, but the edges to the bounding box are filled with white. The image is centered in the bounding box. |
| Cover | GET `/example_100_100.jpg?fit=cover` | The image is resized where the requested sizes function as a minimum instead of a maximum |
| Blurring | GET `/example_100_100.jpg?blur=true` | The image is blurred slightly |
| Crop on upload | POST `/example.jpg?x=30&y=40&width=100&height=200` | The image original is saved after cropping by the suggested parameters |


## How to use

### Requesting an image

You can simply request an image using a plain GET request to `http://localhost:1337/example_100_100.png`.
This will trigger the server to search for the image with id `example`, and serve it in a PNG format in a `100x100` resolution.
Depending on earlier requests, the image might be on the CDN (causing a redirect) or be transcoded on the fly and uploaded later.
For Retina (or HiDpi) displays, the postfix `_2x` will appropriately resize the image to that size (or perform a redirect).
Additional options can be send through the query parameter, such as `?fit=crop` to crop the image to the bounding box you request.

### Uploading images

In order to upload an image, you need to do a POST request to `/token`.
This post has an payload of an id in json.
This endpoint should generally be filtered out by your firewall or loadbalancer.
The received token is valid for 15 minutes.
The client can then directly use this token to upload a file.

An example command in curl is `curl -vvv -XPOST http://localhost:1337/token -d '{"id": "test"}' -H "Content-Type: application/json"`

The client uses another `POST` request to `http://localhost:1337/someimage.jpg`, this will cause the `someimage` key to be used.
A token also should be send along, this is done in the HTTP-Headers in the `X-Token` parameter.
The token will automatically expire once used.
The token is only valid for one upload attempt and one id.

An example command in curl is `curl -vvv -XPOST http://localhost:1337/test.jpg -H "X-Token: earlier-return-value" -F "image=@/home/user1/Desktop/test.jpg"`

## Configuration

### Settings

You need to copy the `default.json.example` to `default.json` in the `config` directory.
Then, specify your own values.

In case you like to use it in production, call the script like this:

```bash
NODE_ENV=production node index.js
```

It will then additionally load the `production.json` file.

The following settings are supported:

| key | description |
|---|---|
| aws.access_key | Access key for AWS |
| aws.secret_key | Secret key for AWS |
| aws.region | Region of your AWS bucket |
| aws.bucket | Name of your AWS bucket |
| aws.cache_host | The resource server which holds the caches (e.g. `https://s3-eu-west-1.amazonaws.com/bucket` or your CloudFront distribution). Do not add a trailing slash. |
| aws.bucket_url | URL of your AWS bucket _(deprecated, use `aws.cache_host` instead)_ |
| originals_dir | Path to where the original images should be stored |
| listen_address | Address on which the server should listen |
| postgresql.user | PostgreSQL username |
| postgresql.password | PostgresSQL password |
| postgresql.host | Host on which the database is running |
| postgres.database | Name of your database |
| allow_indexing | Whether to allow robots to index the images |
| constraints.max_width | The maximum allowed width of the image. If a request is made that succeeds this width then a redirect is issued to an equivalent image within bounds. |
| constraints.max_height | The maximum allowed height of the image. If a request is made that succeeds this height then a redirect is issued to an equivalent image within bounds. |
| log.[level] | Whether to enable logs generated with the specified level, Where level is one of debug, info, warn or error. |
| redirect_cache_timeout | Cache age in seconds of redirects to AWS. This value is used as the max-age in the Cache-Control header |

### Database

To keep the cache links, an additional Postgresql database is used.
The program will auto create the tables and maintain the schema, using [pg-migration](https://github.com/rogierslag/pg-migration).
You can use a Docker container to run postgresql in development, or use the [excellent postgres app for OSX](http://postgresapp.com/).
You need to create the database and its credentials yourself.
After creating these, edit the `default.json` config file.
An example for command line `psql` is:

```bash
 sudo -u postgres psql -c "CREATE USER imageresizer WITH PASSWORD 'rogierisgaaf';"
 sudo -u postgres createdb -E UTF8 -T template0 --locale=en_US.utf8 imageresizer
 sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE imageresizer to imageresizer;"
 ```

### Originals

For quick saving, the original files are kept in `images` subdirectory (retrieving from AWS S3 to determine whether an image exists is too slow).
Be sure to keep this data and backup it.
You can also use the config to let it point to another directory.
In that case, ensure the user can write there!

### Clearing the AWS caches

Sometimes you want to be able to clear cached images, because e.g. a new instance will fix a bug.

You can do this easily by gradually removing the cached links from the database.
In that case, the image is simply recomputed and uploaded from the fresh instance.

A command to do this in `psql` is for example

```bash
sudo -u postgres psql imageresizer -c "DELETE FROM images WHERE ctid IN (SELECT ctid FROM images where rendered_at < '2016-09-01 00:00:00' LIMIT 100);"
```

By limiting it to 100 images per run, you ensure the instances are not suddenly hit with lots of traffic.
You can combine the above command with a `screen` and `watch` command to automate the entire cache purge.

Don't forget to set the date correctly ;)

## Developing

Developing is relatively easy, once you know how it works.
Since some programs are required for running the application, we recommend to develop using Docker (the rebuild is quite fast).
On Linux and Windows, you will need to install Docker.
On OSX the Docker Toolbox suffices.

1. After installing the Docker toolbox (which we will use here), you need to create a Docker machine `docker-machine create inventid --driver=virtualbox`
2. Then define the docker machine `eval $(docker-machine env inventid)`
3. Ensure you have a PostgreSQL instance available, see the section on _Database_ on how to achieve this
3. Next (this also applies for Linux) we'll create the container `mkdir -p /tmp/images && docker build --tag=test . && docker run -p 1337:1337 -v /tmp/images:/opt/images -v <YOUR_GIT_REPO_LOCATION>/config:/opt/iaas/config test`
4. Now you can start developing. After each change, stop the container (Ctrl-C) and re-execute the command again. Rebuilds of the container are relatively fast.

Quick way to send images (ensure you have `jq` installed)
```bash
IMAGE=test1234567
PORT=1337
RES=`curl -vvv -XPOST http://localhost:$PORT/token -d "{\"id\": \"${IMAGE}\"}" -H "Content-Type: application/json"`
TOKEN=`echo $RES | jq -r .token`
curl -vvv -XPOST http://localhost:$PORT/${IMAGE} -H "X-Token: ${TOKEN}" -F "image=@/Users/Rogier/Downloads/IMG_7419.PNG"
```

## Contributing

You can use the `Dockerfile` to quickly stage stuff locally (on OSX use `docker-machine`).

If you have additions for the code, please [fork the repo](https://github.com/inventid/iaas/fork) and open a Pull Request.

![Main developing companies](https://github.com/inventid/iaas/blob/develop/images/example?raw=true)
