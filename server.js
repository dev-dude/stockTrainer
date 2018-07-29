const express = require('express')
const app = express()
const configFile = require('./configFile.json')
const moment = require('moment');

const fs = require('fs');
const request = require('request');
const parse = require('csv-parse');
const bodyParser = require('body-parser');
const stockRsi = require('technicalindicators').RSI;
const AWS = require('aws-sdk');

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

const models = [
    {"type":"1 day ahead no volume","model":"ml-swqlD7B0tW2"},
    {"type":"2 days ahead no volume","model":"ml-fu7bKU8rxBI"},
];
AWS.config.update(configFile.awsKeys);

AWS.config.update({region:'us-east-1'});
const ml = new AWS.MachineLearning({ signatureVersion: 'v4' });


let csvData=[];
let priceData=[];
let count = 0;
let csvAllRows = [];
let stockRSIValues = [];
let intialRun = true;
let firstRunData = {};
let isBuy = true;
let testData = [45.15,46.26,46.5,46.23,46.08,46.03,46.83,47.69,47.54,49.25,49.23,48.2,47.57,47.61,48.08,47.21,46.76,46.68,46.21,47.47,47.98,47.13,46.58,46.03,46.54,46.79,45.83,45.93,45.8,46.69,47.05,47.3,48.1,47.93,47.03,47.58,47.38,48.1,48.47,47.6,47.74,48.21,48.56,48.15,47.81,47.41,45.66,45.75,45.07,43.77,43.25,44.68,45.11,45.8,45.74,46.23,46.81,46.87,46.04,44.78,44.58,44.14,45.66,45.89,46.73,46.86,46.95,46.74,46.67,45.3,45.4,45.54,44.96,44.47,44.68,45.91,46.03,45.98,46.32,46.53,46.28,46.14,45.92,44.8,44.38,43.48,44.28,44.87,44.98,43.96,43.58,42.93,42.46,42.8,43.27,43.89,45,44.03,44.37,44.71,45.38,45.54];
let rsiTestData = [54.09,59.90,58.20,59.76,52.35,52.82,56.94,57.47,55.26,57.51,54.80,51.47,56.16,58.34,56.02,60.22,56.75,57.38,50.23,57.06,61.51,63.69,66.22,69.16,70.73,67.79,68.82,62.38,67.59,67.59];
let totalPredictions = [];
let mlPredictCounter = 0;
let buyData = [];
let buyDataAndDateOnly = [];
let backTestData = [];
let backTestCorrect = 0;
let backTestNonCorrect = 0;

function parseBuyAndSellData(res) {
    buyData = [];
    buyDataAndDateOnly = [];
    count = 0;
    fs.createReadStream("./buyData.csv")
    .pipe(parse({delimiter: ','}))
    .on('data', function(csvrow) {
        buyData.push(csvrow);
        let timeStamp = moment(csvrow[0]).utc().unix();
        if (count > 0) {
            buyDataAndDateOnly.push({"timeStamp":timeStamp * 1000,"action":csvrow[6]});
        }
        count++;
    }).on('end',function() {
        parseData(res);
    });
}

function parseData(res) {
    count = 0;
    fs.createReadStream("./test.csv")
    .pipe(parse({delimiter: ','}))
    .on('data', function(csvrow) {
        
        if (intialRun) {
            csvAllRows.push(csvrow);
        }
        let timeStamp = moment(csvrow[0]).utc().unix();
        let formattedTimeStamp = moment(parseInt(timeStamp.toString()+"000")).format("D/M/Y");
        let csvObj = [timeStamp*1000,parseFloat(csvrow[4]),count];
        if (count > 0) {
            csvData.push(csvObj);       
            priceData.push(parseFloat(csvrow[4]));
        }
        count++;
    })
    .on('end',function() {
    
        console.log("done");

        stockRSIValues = [];
        console.log(priceData.length);
        let stockRsiResult = stockRsi.calculate({
            period: 14,
            values:priceData});
            priceData=[];

        let sendRsiData = [];
       let z = 0;
    
       console.log(stockRsiResult.length);
      
       for (;z < stockRsiResult.length ; z++) {       
        if (z > 13) {
            let last14 = stockRsiResult.slice(z-14,z);
      
            let max = Math.max.apply(null, last14);
            let min = Math.min.apply(null, last14);
            let stochRSI = (last14[last14.length-1] - min) / (max - min);
            stockRSIValues.push(stochRSI.toFixed(2));
            let roundNumber = Math.round(stochRSI * 10) / 10;
            sendRsiData.push([csvData[z+14][0],roundNumber]);
        }
       
      }

      intialRun = false;
      firstRunData = {csvData:csvData,rsiData:sendRsiData,buyDataAndDateOnly:buyDataAndDateOnly};
      res.send(firstRunData);
    });
}

function downloadCsv(response) {
    console.log("download csv");
    let dest = process.cwd() + "\\test.csv";
    request.get({
        headers: {
          'Cookie': 'B=b9ihaitdim360&b=3&s=8m'
        },
        uri: 'http://query1.finance.yahoo.com/v7/finance/download/SPY?period1=946699258&period2=9929548208&interval=1d&events=history&crumb=HbK4LWmmHjG',
        method: 'GET'
      }, function(err, res, body) {     
        console.log(err);
        console.log(dest);
        fs.writeFile(dest, body, function(err) {
            if(err) {
                return console.log(err);
            }
            //console.log(res);
            console.log("The file was saved!");
            parseBuyAndSellData(response);
        }); 
    });
}

function addData(data,res) {
    let i =0;
    let dataRow = [];
    let isBuyBeforeChange = isBuy;
    let adjustedClose = [];



    for (; i < csvAllRows.length; i++) {

        // seed initial columns
        if (i === 0) {
            // Buy
            csvAllRows[i][7] = "Gains";
            csvAllRows[i][8] = "Multi Day Gains";
            csvAllRows[i][9] = "SMA Gains";
            csvAllRows[i][10] = "Stoch RSI";
            csvAllRows[i][11] = "Single Day Volume";
            csvAllRows[i][12] = "Buy";
            continue;
        }

        if (csvAllRows[i][0] === data.time) {
            console.log("isBuy:" + isBuy);
            if (isBuy) {
                csvAllRows[i][12] = 1;
                isBuy = false;
            } else {
                csvAllRows[i][12] = -1;
                isBuy = true;
            }
            dataRow = csvAllRows[i];
        } else {
            csvAllRows[i][7] = "";
            csvAllRows[i][8] = "";
            csvAllRows[i][9] = "";
            csvAllRows[i][10] = "";
            csvAllRows[i][11] = "";
            csvAllRows[i][12] = "0";
        }

        let calcMovingAverage = [];
        if (i > 1) {
            let singleDayVolume = ((csvAllRows[i][6] - csvAllRows[i-1][6]) / csvAllRows[i-1][6]);
            let singleDayGains = ((csvAllRows[i][5] - csvAllRows[i-1][5]) / csvAllRows[i-1][5]);
            csvAllRows[i][7] = singleDayGains.toFixed(3); 
            csvAllRows[i][11] = singleDayVolume.toFixed(3)
            if (i > 2) {
                let multiDayGains = ((csvAllRows[i][5] - csvAllRows[i-2][5]) / csvAllRows[i-2][5]);
                csvAllRows[i][8] = multiDayGains.toFixed(3);
                if (i > 3) {
                    let smaGains = ((parseFloat(csvAllRows[i][7]) + parseFloat(csvAllRows[i-1][7]) +  parseFloat(csvAllRows[i-2][7])) / 3);
                    csvAllRows[i][9] = smaGains.toFixed(3);
                }
            }
        }

        if (i > 28 && stockRSIValues[i-29]) {
            let roundNumber = Math.round(stockRSIValues[i-29] * 10) / 10;
            csvAllRows[i][10] = parseFloat(roundNumber);
        }
    }
   let convertedRows = "";
   let x = 0;
   for (; x < csvAllRows.length; x++) {

    convertedRows += csvAllRows[x][0] + "," +  csvAllRows[x][7] + "," + csvAllRows[x][8] + "," + csvAllRows[x][9] +
     "," + csvAllRows[x][10] + "," + csvAllRows[x][11] + "," + csvAllRows[x][12] + "\n";
   }
   let lastRow = csvAllRows[csvAllRows.length - 1]; 
   
   let p = new Promise(function(resolve, reject) {
       mlPredictCounter = 0;
       totalPredictions = [];
       mlPredict(resolve,dataRow,false);
   });

    p.then(function(data){
       if (convertedRows.length > 0) {
            fs.writeFile('public/testout.csv', convertedRows, 'utf8', function (err) {
                if (err) {
                console.log(err);
                console.log('Some error occured - file either not saved or corrupted file saved.');
                res.send({msg:"error","data":dataRow,"isBuy":isBuyBeforeChange,"predictions":totalPredictions, "lastRow":dataRow});
                } else{
                console.log('It\'s saved!');
                res.send({msg:"saved","data":dataRow,"isBuy":isBuyBeforeChange,"predictions":totalPredictions, "lastRow":dataRow});
                }
            });
        } else {
            res.send({msg:"error","data":dataRow,"isBuy":isBuyBeforeChange,"predictions":totalPredictions, "lastRow":dataRow});
        }
    });
}

function backTest(res) {
    let u = 0;
    let testMode = true;
    backTestCorrect = 0;
    backTestNonCorrect = 0;
    let testCount = 0;
    backTestData = [];
    for (; u < buyData.length;u++) {
        if (buyData[u][6] == "-1" || buyData[u][6] == "1") {
            if (testMode && backTestData.length > 20) {
                break;
            }
            testCount++;
            let predictAccuracyObj = {decision:0,dataOneDayBackData:{},mlPredict:{},correct:null};
            predictAccuracyObj.decision = buyData[u][6];
            predictAccuracyObj.dataOneDayBackData = buyData[u-1];
            backTestData.push(predictAccuracyObj);
        }
    }
    console.log("total test rows " + testCount);
    console.log("starting model verification");

    let p = new Promise(function(resolve, reject) {
        mlPredictCounter = 0;
        mlPredict(resolve,null,true);
    });
    p.then(function(){
        console.log("backTest Correct" + backTestCorrect);
        console.log("backTest False " + backTestNonCorrect);
        console.log("percentage correct " + backTestCorrect/backTestData.length);
        console.log("percentage notcorrect " + backTestNonCorrect/backTestData.length);
        res.send({"status":"success"});
    });
}

function mlPredict(resolve,lastRow,backTest) {
    if (
        !backTest && mlPredictCounter < models.length || 
        backTest && mlPredictCounter < backTestData.length
    ) {

        let activeModel;
        let gains;
        let multiDayGains;
        let smaGains;
        let stochRsi;
        let volume;
        if (backTest) {
            activeModel = models[0];
            lastRow = backTestData[mlPredictCounter].dataOneDayBackData;
            gains = lastRow[1].toString();
            multiDayGains = lastRow[2].toString();
            smaGains = lastRow[3].toString();
            stochRsi = lastRow[4].toString();
            volume = lastRow[5].toString();
        } else {
            gains = lastRow[7].toString();
            multiDayGains = lastRow[8].toString();
            smaGains = lastRow[9].toString();
            stochRsi = lastRow[10].toString();
            volume = lastRow[11].toString();
            activeModel = models[mlPredictCounter];
        }

        let params = {
            MLModelId: activeModel.model, 
            PredictEndpoint: 'https://realtime.machinelearning.us-east-1.amazonaws.com',
            Record: {
                "Gains": gains,
                "Multi Day Gains": multiDayGains,
                "SMA Gains": smaGains,
                "Stoch RSI": stochRsi,
                "Single Day Volume": volume
            }
        };

        //console.log(params);

        ml.predict(params, function(err, data) {
            if (err) {
                console.log(err, err.stack);
            } else {     
                //console.log(data);
                let obj = {};

        
                obj.buy = data["Prediction"]["predictedScores"][1].toFixed(2);
                if (data["Prediction"]["predictedScores"][-1]) {
                    obj.sell = data["Prediction"]["predictedScores"][-1].toFixed(2);
                }
                obj.hold = data["Prediction"]["predictedScores"][0].toFixed(2);
                obj.type = activeModel.type;
                totalPredictions.push(obj);
             
                if (backTest) {
                    let mlBuy = parseFloat(obj.buy) > parseFloat(obj.sell);
                    if (mlBuy && backTestData[mlPredictCounter].decision == "1") {
                        backTestData[mlPredictCounter].correct = true;
                        backTestCorrect++;
                    } else if (!mlBuy && backTestData[mlPredictCounter].decision == "-1") {
                        backTestData[mlPredictCounter].correct = true;
                        backTestCorrect++;
                    } else {
                        backTestNonCorrect++;
                        backTestData[mlPredictCounter].correct = false;
                    }
                }

                mlPredictCounter++;

                mlPredict(resolve,lastRow,backTest);
            }
        });
    } else {
        resolve();
    }
}

app.get('/', function(req, res) {
    csvData=[];
    priceData=[];
    count = 0;
    csvAllRows = [];
    stockRSIValues = [];
    intialRun = true;
    firstRunData = {};
    console.log("start");
    downloadCsv(res);
});
app.post('/save', function(req, res) {
    addData(req.body,res);
});

app.get('/backTest', function(req, res) {
    backTest(res);
});

app.listen(8080, () => console.log('Example app listening on port 3000 t!'))