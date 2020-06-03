'use strict';

const AWS = require('aws-sdk');

AWS.config.update({region: 'eu-west-2'});
const dynamoDB = new AWS.DynamoDB({apiVersion: '2012-08-10'});

module.exports.getPatient = async (event, context, callback) => {
    const patientName = event.queryStringParameters.identity;
    const patient = await getPatient(patientName);
    const response = {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Credentials': true,
        },
        body: JSON.stringify({
            patient: patient,      
        })
    };
    callback(null, response);
}

const getPatient = async(name) => {
    const params = {
        TableName: process.env.APPOINTMENT_TABLE,
        Key:{
            "ServiceId": serviceID,
            "Slot": `patient:${slotName}`
        },
        ProjectionExpression: "PatientName, Dob, NhsNumber, Notes"
    }

    const result = await dynamoDB.getItem(params).promise();

    return {
        Name: result.Item.PatientName.S,
        Dob: result.Item.DOB.S,
        NhsNumber: result.Item.NhsNumber.S,
        Notes: result.Item.Notes.S
    }
}