'use strict';

const AWS = require('aws-sdk');
const querystring = require('querystring');
const uuid = require('uuid');

AWS.config.update({region: 'eu-west-2'});
const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});
const docClient = new AWS.DynamoDB.DocumentClient({apiVersion: '2012-08-10'});
const ssm = new AWS.SSM()

const AccessToken = require('twilio').jwt.AccessToken;
const VideoGrant = AccessToken.VideoGrant;

const serviceID = "test-service";

module.exports.getToken = async (event, context, callback) => {

  const slotId = event.queryStringParameters.slot;
  const isHost = event.queryStringParameters.user == "host";

  const slotInfo = await getSlotInfo(slotId);

  // Used when generating any kind of tokens
  const twilioAccountSid = await getParameter("/twilio/account-id")
  const twilioApiKey = await getParameter("/twilio/api-key");
  const twilioApiSecret = await getParameter("/twilio/api-secret");  

  // Create Video Grant
  const videoGrant = new VideoGrant({
    room: slotId,
  });

  // Create an access token which we will sign and return to the client,
  // containing the grant we just created
  const token = new AccessToken(twilioAccountSid, twilioApiKey, twilioApiSecret);
  token.addGrant(videoGrant);
  token.identity = isHost ? slotInfo.HostName : slotInfo.SubjectName;

  const response = {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({
      slotInfo: slotInfo,
      token: token.toJwt()
    }),
  };

  callback(null, response);
};

module.exports.createSlot = async (event, context, callback) => {
  const requestBody = JSON.parse(event.body);
  const slotId = await insertAppointment(requestBody.subjectName, requestBody.hostName);
  const response = {
    statusCode: 201,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Credentials': true,
    },
    body: JSON.stringify({
      message: "Appointment created",
      slotId: slotId
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

  const slotInfo = await getSlotInfo(roomName);

  if (participant != slotInfo.SubjectName)
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

const insertAppointment = async (subjectName, hostName) => {
  const slotId = uuid.v4(); 
  const params = {
    TableName: process.env.APPOINTMENT_TABLE,
    Item: {
      'ServiceId' : {S: serviceID},
      'Slot' : {S: `slot:${slotId}`},
      'SubjectName': {S: subjectName},
      'HostName': {S: hostName},
      'State' : {S: 'pending'}
    }
  };
  
  await dynamoDB.putItem(params).promise();  
  return slotId;
}

const updateAppointment = async (slotId, newState) => {
  const params = {
    TableName: process.env.APPOINTMENT_TABLE,
    Key:{
        "ServiceId": serviceID,
        "Slot": `slot:${slotId}`
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
  await docClient.update(params).promise();
}

const getAppointments = async () => {
  const params = {
    ExpressionAttributeNames: {
      "#st": "State"
    },
    ExpressionAttributeValues: {
        ':serviceId' : serviceID,
        ':slot': 'slot:'
    },
    KeyConditionExpression: 'ServiceId = :serviceId and begins_with(Slot, :slot)',
    ProjectionExpression: 'Slot, SubjectName, HostName, #st',    
    TableName: process.env.APPOINTMENT_TABLE
  };

  return await scan(params);
}

const scan = async (params) => {

  const { Items, LastEvaluatedKey } = await docClient.query(params).promise();
  
  const thisData = Items.map(i => ({
      SlotId: i.Slot.replace("slot:", ""),
      SubjectName: i.SubjectName,
      HostName: i.HostName,
      State: i.State
    }))

  let nextData = []

  if (typeof LastEvaluatedKey != "undefined") {
    params.ExclusiveStartKey = data.LastEvaluatedKey;
    nextData = await scan(params);        
  }      

  return [...thisData, ...nextData];       
}

const getSlotInfo = async(slotId) => {
    console.log("get slot " + slotId)
    const params = {
        TableName: process.env.APPOINTMENT_TABLE,
        Key:{
            "ServiceId": {S: serviceID},
            "Slot": {S: "slot:" + slotId}
        },
        ProjectionExpression: "SubjectName, HostName"
    }

    const result = await dynamoDB.getItem(params).promise();

    return {
        SubjectName: result.Item.SubjectName.S,
        HostName: result.Item.HostName.S
    }
}