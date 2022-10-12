import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as appsync from '@aws-cdk/aws-appsync-alpha';
import * as path from 'path';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import lambda = require("@aws-cdk/aws-lambda-go-alpha");
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
export interface ServiceStackCommonProps extends cdk.StackProps {
  Environment:string;
}
export interface ServiceStackProps extends ServiceStackCommonProps {
  UserPoolId:string;
  ConfigurationTableArn: string;
}
export class MeasurementServicesSharedStack extends cdk.Stack {
  public readonly ConfigurationTable: Table;
  constructor(scope: Construct, id: string, props: ServiceStackCommonProps) {
    super(scope, id, props);
    
    const dynamoTable = new Table(this, 'configuration', {
      tableName:props.Environment+"-"+"configuration",
      partitionKey: {
        name: 'pk',
        type: AttributeType.STRING
      },
      sortKey:{
        name:'sk',
        type:AttributeType.STRING
      }, 
      removalPolicy: cdk.RemovalPolicy.RETAIN, // NOT recommended for production code
      billingMode:BillingMode.PAY_PER_REQUEST
    });
    this.ConfigurationTable=dynamoTable;    
  }
}
export class MeasurementServicesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    // Creates the AppSync API
    const userPool = cognito.UserPool.fromUserPoolId(this,id,props.UserPoolId);

    const api = new appsync.GraphqlApi(this, props.Environment+'measurement-service', {
      name: props?.Environment+'measurement-service',
      schema: appsync.Schema.fromAsset(path.join(__dirname, 'schema.graphql')),
      
      authorizationConfig: {
        additionalAuthorizationModes:[{
          authorizationType:appsync.AuthorizationType.IAM          
        }],
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool:userPool
          }
        },
      },
      xrayEnabled: true,
    });

    // Prints out the AppSync GraphQL endpoint to the terminal
    new cdk.CfnOutput(this, "GraphQLAPIURL", {
     value: api.graphqlUrl
    });
    const measurementFunction = new lambda.GoFunction(this, 'measurement', {
      entry: 'src/cmd/api/measurement',
      functionName:this.node.id+"-measurement",
      timeout:cdk.Duration.seconds(10),
      environment: {
        SENSOR_MEASUREMENT_DATABASE:"dev-measurements",
        SENSOR_MEASUREMENT_TABLE:"readings"
      },
    });

    measurementFunction.addToRolePolicy(
      new PolicyStatement (
        {
          actions: ["timestream:DescribeEndpoints","timestream:SelectValues"],
          resources: ["*"],
          effect: Effect.ALLOW
        }
      )
    )
    measurementFunction.addToRolePolicy(
      new PolicyStatement (
        {
          actions: ["timestream:Select","timestream:DescribeTable","timestream:ListMeasures","timestream:WriteRecords"],
          resources: ["arn:aws:timestream:us-east-1:429630199115:database/dev-measurements", "arn:aws:timestream:us-east-1:429630199115:database/dev-measurements/table/readings"],
          effect: Effect.ALLOW
        }
      )
    )
    const configurationTable = Table.fromTableArn(this,"config",props.ConfigurationTableArn)
    const thresholdFunction = new lambda.GoFunction(this, 'threshold', {
      entry: 'src/cmd/api/threshold',
      functionName:this.node.id+"-threshold",
      timeout:cdk.Duration.seconds(10),
      environment: {
        CONFIGURATION_TABLE:configurationTable.tableName
      },
    });
    configurationTable.grantReadWriteData(thresholdFunction);

    const queryFunction = new lambda.GoFunction(this, 'query', {
      entry: 'src/cmd/api/query',
      functionName:this.node.id+"-query",
      timeout:cdk.Duration.seconds(10),
      environment: {
        SENSOR_MEASUREMENT_DATABASE:"dev-measurements",
        SENSOR_MEASUREMENT_TABLE:"readings"
      },
    });

    queryFunction.addToRolePolicy(
      new PolicyStatement (
        {
          actions: ["timestream:DescribeEndpoints","timestream:SelectValues"],
          resources: ["*"],
          effect: Effect.ALLOW
        }
      )
    )
    queryFunction.addToRolePolicy(
      new PolicyStatement (
        {
          actions: ["timestream:Select","timestream:DescribeTable","timestream:ListMeasures","timestream:WriteRecords"],
          resources: ["arn:aws:timestream:us-east-1:429630199115:database/dev-measurements", "arn:aws:timestream:us-east-1:429630199115:database/dev-measurements/table/readings"],
          effect: Effect.ALLOW
        }
      )
    )
    const requestMappingTemplate = `{
      "version" : "2017-02-28",
      "operation": "Invoke",
      "payload": {
          "location": $util.toJson($context.args.params.location),
          "level": $util.toJson($context.args.params.level),
          "index": $util.toJson($context.args.params.index),
          "substance": $util.toJson($context.args.params.substance),
          "operation": $util.toJson($context.info.fieldName)
      }
  }`;
    const measurementDS = api.addLambdaDataSource("get-measurements",measurementFunction);
    const thresholdDS = api.addLambdaDataSource("get-threshold",thresholdFunction);
    const querydDS = api.addLambdaDataSource("query-measurements",queryFunction);
    measurementDS.createResolver({
      requestMappingTemplate: appsync.MappingTemplate.fromString(requestMappingTemplate),
      typeName: "Query",
      fieldName: "getAggMeasurements"
    });
    measurementDS.createResolver({
      requestMappingTemplate: appsync.MappingTemplate.fromString(requestMappingTemplate),
      typeName: "Query",
      fieldName: "getDetailMeasurements"
    });
    measurementDS.createResolver({
      requestMappingTemplate: appsync.MappingTemplate.fromString(requestMappingTemplate),
      typeName: "Query",
      fieldName: "getLocationMeasurements"
    });
    thresholdDS.createResolver({
      typeName: "Query",
      fieldName: "getSubstanceThresholds"
    });
    const queryRequestMappingTemplate = `{
      "version" : "2017-02-28",
      "operation": "Invoke",
      "payload": {
          "location": $util.toJson($context.args.params.location),
          "interval": $util.toJson($context.args.params.interval),
          "substanceKey": $util.toJson($context.args.params.substanceKey)
      }
  }`;
    querydDS.createResolver({
      requestMappingTemplate: appsync.MappingTemplate.fromString(queryRequestMappingTemplate),
      typeName: "Query",
      fieldName: "getSusbtanceMeasurements"
    });
  }  
}
