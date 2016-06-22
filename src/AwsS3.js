import AWS from "aws-sdk";
import config from "config";

// The AWS config needs to be set before this object is created
AWS.config.update({
  accessKeyId: config.get('aws.access_key'),
  secretAccessKey: config.get('aws.secret_key'),
  region: config.get('aws.region')
});
const S3 = new AWS.S3();
export default S3;
