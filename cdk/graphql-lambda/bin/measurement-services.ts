#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { MeasurementServicesSharedStack, MeasurementServicesStack } from '../lib/measurement-services-stack';

const app = new cdk.App();
const configurationStack = new MeasurementServicesSharedStack(app, 'dev-measurement-shared-service-stack', {
  env: { account: '429630199115', region: 'us-east-1' },
  Environment:"dev",
});
const tableArn = configurationStack.ConfigurationTable.tableArn;
const measurementServiceStack = new MeasurementServicesStack(app, 'dev-measurement-service-stack', {
  env: { account: '429630199115', region: 'us-east-1' },
  Environment:"dev",
  UserPoolId:"us-east-1_iTQ0HqEDz",
  ConfigurationTableArn:tableArn
});

cdk.Tags.of(measurementServiceStack).add('environment', 'dev');
app.synth();