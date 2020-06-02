'use strict';

const AWS = require('aws-sdk');
const querystring = require('querystring');

AWS.config.update({region: 'eu-west-2'});
const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});
const docClient = new AWS.DynamoDB.DocumentClient({apiVersion: '2012-08-10'});
const ssm = new AWS.SSM()

const AccessToken = require('twilio').jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

const serviceID = "test-service";

module.exports.getToken = async (event, context, callback) => {

  //console.log(event);
  const identity = event.queryStringParameters.identity;
  const roomName = event.queryStringParameters.room;

  // Used when generating any kind of tokens
  const twilioAccountSid = await getParameter("/twilio/account-id")
  const twilioApiKey = await getParameter("/twilio/api-key");
  const twilioApiSecret = await getParameter("/twilio/api-secret");  

  // Create Video Grant
  const videoGrant = new VideoGrant({
    room: roomName,
  });

  // Create an access token which we will sign and return to the client,
  // containing the grant we just created
  const token = new AccessToken(twilioAccountSid, twilioApiKey, twilioApiSecret);
  token.addGrant(videoGrant);
  token.identity = identity;

  const response = {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({
      token: token.toJwt()
    }),
  };

  callback(null, response);
};

module.exports.createSlot = (event, context, callback) => {
  const requestBody = JSON.parse(event.body);
  insertAppointment(requestBody.subjectName);
  const response = {
    statusCode: 201,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({
      message: "Appointment created",
      subjectName: requestBody.subjectName
    })
  };

  callback(null, response);
}

module.exports.getSlots = async (event, context, callback) => {
  const slots = await getAppointments();
  const response = {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({
      slots: slots,      
    })
  };

  callback(null, response);
}

module.exports.updateSlotStatus = async (event, context, callback) => {
  const requestData = querystring.parse(event.body);
  const participant = requestData["ParticipantIdentity"];
  const roomName = requestData["RoomName"];
  const action = requestData["ParticipantStatus"];

  if (participant != roomName)
    callback(null, {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Credentials': true,
      },
    });
  else {
    await updateAppointment(roomName, action);
    callback(null, {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Credentials': true,
      },
    });
  }
}

const getParameter = async (paramName) => {
 const result = await ssm.getParameter({
   Name: paramName
 }).promise();

 return result.Parameter.Value;
}

const insertAppointment = subjectName => {
  var params = {
    TableName: process.env.APPOINTMENT_TABLE,
    Item: {
      'ServiceId' : {S: serviceID},
      'Slot' : {S: subjectName},
      'State' : {S: 'pending'}
    }
  };
  
  // Call DynamoDB to add the item to the table
  dynamoDB.putItem(params, function(err, data) {
    if (err) {
      console.log("Error", err);
    } else {
      console.log("Success", data);
    }
  });
}

const updateAppointment = async (slotName, newState) => {
  const params = {
    TableName: process.env.APPOINTMENT_TABLE,
    Key:{
        "ServiceId": serviceID,
        "Slot": slotName
    },
    UpdateExpression: "set #st = :newState",
    ExpressionAttributeNames: {
      "#st": "State"
    },
    ExpressionAttributeValues:{
        ":newState": newState        
    },
    ReturnValues:"UPDATED_NEW"
  };

  console.log(params);

  await docClient.update(params).promise();
}

const getAppointments = async () => {
  const params = {
    ExpressionAttributeNames: {
      "#st": "State"
    },
    ProjectionExpression: 'Slot, #st',    
    TableName: process.env.APPOINTMENT_TABLE
  };

  return await scan(params);   
}

const scan = async (params) => {

  const { Items, LastEvaluatedKey } = await dynamoDB.scan(params).promise();
  
  const thisData = Items.map(i => ({
      Slot: i.Slot.S,
      State: i.State.S
    }))

  let nextData = []

  if (typeof LastEvaluatedKey != "undefined") {
    params.ExclusiveStartKey = data.LastEvaluatedKey;
    nextData = await scan(params);        
  }      

  return [...thisData, ...nextData];       
}