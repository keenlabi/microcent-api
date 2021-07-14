const { UserModel, OtpModel} = require('../models');
const bcrypt = require('bcrypt');
const { cloudinary } = require('../services');
const { picture } = require('../services/cloudService');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const path = require('path');
const sharp = require('sharp');
const { options } = require('../routes/userRoutes');
const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const vision = require('@google-cloud/vision');
var crypto = require("crypto");
var eccrypto = require("eccrypto");
const resemble = require("resemblejs");
const { rejects } = require('assert');

const userEncryption = (req, res)=>{
    // A new random 32-byte private key.
var privateKey = eccrypto.generatePrivate();

// Corresponding uncompressed (65-byte) public key.
// var publicKey = eccrypto.getPublic(privateKey) ;

console.log(privateKey.toString('hex'));

// var str = "message to sign";
// // Always hash you message to sign!
// var msg = crypto.createHash("sha256").update(str).digest();
}

const userRegister = (req, res)=>{
    //Validate user request
    var result = validateReq(req.body);
    if(!result.status) return res.status(422).send({message: result.message});

    // Check if user already exists
    UserModel.findOne({i_email: req.body.email.toLowerCase()}).then(async (foundUser)=>{
        console.log(foundUser);
        if(foundUser) return res.status(409).send({message: "User with this email already exist."});
        else {
            //Insert new user if dont exist 
            const { 
                firstname, surname, birthday, gender, maritals, occupation, email, phone, password, address,
                hkidfirstname, hkidsurname, hkidgender, hkidbirthday
            } = req.body;
            
            const urls = [];
            const files = req.files;

            for(var i = 0; i < files.length; i++){
                const newPath = await cloudinaryImageUploadMethod(files[i]);
                urls.push(newPath);
            }
            
            bcrypt.genSalt(10).then(salt=>{
                bcrypt.hash(password, salt, (err, passwordHash) =>{
                    UserModel.create({
                        i_fname: firstname.toLowerCase(),
                        i_sname: surname.toLowerCase(),
                        i_bday: birthday.toLowerCase(),
                        i_gender: gender.toLowerCase(),
                        i_maritals: maritals.toLowerCase(),
                        i_occupation: occupation.toLowerCase(),

                        hkid_fname: hkidfirstname.toLowerCase(),
                        hkid_sname: hkidsurname.toLowerCase(),
                        hkid_bday: hkidbirthday.toLowerCase(),
                        hkid_gender: hkidgender.toLowerCase(),
                        // hkid_photo: urls[0].res,
                        // doc_hkid: urls[1].res,

                        // i_photo: urls[2].res,
                        
                        i_address: address,
                        doc_address: urls[0].res,

                        i_email: email.toLowerCase(),
                        i_phone: phone.toLowerCase(),
                        i_pass: passwordHash,

                        doc_additional: urls[1].res
                    }).then((saved)=>{
                        console.log(saved);
                        console.log(`New user has been created.'`);
                        return res.status(200).send({message: "User has been registered successfully."});

                        console.log('Success');
                    }).catch((error)=>{
                        return res.status(409).send({message: error.message});
                    });
                });
            });
        }
    }).catch((error)=>{
        console.log(error);
        return res.status(500).send({message: "There was a server error, not your fault, we are on it."});
    });
}

const userAuth = (req, res)=>{
    console.log(req.body);
    const { email, password } = req.body;

    UserModel.findOne({i_email: email}).then((foundUser)=>{
        if(!foundUser) return res.status(404).send({message: "User doesn't exist."});
        bcrypt.compare(password, foundUser.i_pass, async (error, result)=>{
            if(error) res.status(500).send({message: "There was a server error, please try again."});
            if(!result) return res.status(404).send({message: "Wrong password."});
           
            foundUser.i_pass = undefined;
            req.session.user = foundUser;
            console.log(`User ${foundUser.i_email} has signed in.`);

            return res.status(200).send({message: "You have successfully signed in", data: req.session.user});
        });
    }).catch((error)=>{
        console.log(error);
        return res.status(500).send({message: "There was a server error, please try again."});
    });
}

const sendOTP = async (req, res)=>{
    // GENERATE OTP
    var result = await generateOTP(6);
    var messageToSend = `Kindly Use this code: ${result} to confirm your new means of authentication for the MICROCENT Mobile App`;

    OtpModel.findOne({email: req.body.email}, (err, foundUser)=>{
        if(err) res.status(500).send({message: "There was a server error, we are on it. Please try again."});
        else {
            if(!foundUser){
                OtpModel.create({
                    code: result, email: req.body.email
                })
                .then((result) => {
                    twilioClient
                        .messages
                        .create({
                            body: messageToSend,
                            from: '+12813773596',
                            to: req.body.phone
                        })
                        .then(message => {
                            console.log({message: 'OTP sent', ssid: message.sid});
                            res.send.status(200).send({message: 'OTP sent', ssid: message.sid})
                        })
                        .catch(error => {
                            console.log({message: error});
                            res.status(300).send({message: "There was an error sending message, make sure phone number is not empty when you try again"});
                            console.log({message: error.status.toString()}); 
                            res.send({message: error.status.toString()});
                        });
                });
            } else {
                OtpModel.deleteOne({email: req.body.email})
                .then(deleted => {
                    OtpModel.create({
                        code: result, email: req.body.email
                    })
                    .then((result)=> {
                        twilioClient
                            .messages
                            .create({
                                body: messageToSend,
                                from: '+12813773596',
                                to: req.body.phone
                            })
                            .then(message => {
                                console.log({message: 'OTP sent', ssid: message.sid});
                                res.send({message: 'OTP sent', ssid: message.sid})
                            })
                            .catch(error => {
                                console.log({message: error});
                                console.log({message: error.status.toString()});
                                res.send({message: error.status.toString()})
                            });
                    });
                })
            }
        }
    });
}

const verifyOTP = async (req, res)=>{
    console.log(req.body);

    OtpModel.findOne({email: req.body.email}, (err, foundOTP)=>{
        if(err) res.status(422).send({message: result.message});
        else {
            if(!foundOTP) res.status(404).send({message: 'OTP doesnt exist for user'});
            else {
                if(foundOTP.code != req.body.code) res.status(404).send({message: 'OTP doesnt exist for user'});
                else res.status(200).send({message: 'OTP verified'});
            }
        }
    })
}

const checkNumber = async (req, res)=>{
    twilioClient.lookups.v1.phoneNumbers('+85255668180')
                                            .fetch({type: ['carrier']})
                                            .then(phone_number=> console.log(phone_number.carrier));
}

const compareUserFaceWithHKIDFace = async (req, res)=>{
    console.log(req.files);
    var images = [];

    for(var i = 0; i < req.files.length; i++) {
        var result = await extractFace(req.files[i].path, res);
        console.log(result);
        images.push(result.res);
    };

    resemble(images[0])
    .compareTo(images[1])
    .ignoreColors()
    .onComplete(function (data) {
        console.log(data);
        res.status(200).send({result: data});
    });

}

function extractFace (image_path, res) {
    return new Promise(resolve => {
        console.log(image_path);

        // Extract face from image of hkid card
        var image =  fs.readFileSync(image_path, {encoding: null});
        
        sharp(image)
        .rotate()
        .resize(1500, 1500)
        .toBuffer()
        .then(newimage => {
        // Performs face detection on the image file
        const client = new vision.ImageAnnotatorClient({keyFilename:  path.resolve("./") + '/microcent-ml-googleapikey.json'});
        client 
            .faceDetection(newimage)
            .then(results =>{
                // console.log(results[0].faceAnnotations[0].boundingPoly);
                const left = results[0].faceAnnotations[results[0].faceAnnotations.length - 1].boundingPoly.vertices[0].x,
                top = results[0].faceAnnotations[results[0].faceAnnotations.length - 1].boundingPoly.vertices[0].y,
                width = results[0].faceAnnotations[results[0].faceAnnotations.length - 1].boundingPoly.vertices[2].x - left,
                height = results[0].faceAnnotations[results[0].faceAnnotations.length - 1].boundingPoly.vertices[2].y - top;

                sharp(newimage)
                    .rotate()
                    .extract({left: left, top: top, width: width, height: height})
                    .toBuffer()
                    .then(newfile=> {
                        console.log("Image crop success");
                        resolve({
                            status: 'success',
                            res: newfile
                        });
                    })
                    .catch(err=>{
                        console.log("error cropping image" + err);
                        res.status(400).send({
                            message: "There was an error extracting face from image. Try again."
                        });
                    });
            })
            .catch(results => {
                console.log(results);
                console.log("There was an error");
                res.status(400).send({
                    message: "There was an error detecting face from image. Try again."
                });
            });
        });
    });
}

const extracthkid = async (req, res)=>{

    var image =  fs.readFileSync(req.file.path, {encoding: null});

    const client = new vision.ImageAnnotatorClient({
        keyFilename:  path.resolve("./") + '/microcent-ml-googleapikey.json'
    });

    // Performs Label detection on the image file
    client
        .textDetection(image)
        .then(results =>{
            console.log(results[0].fullTextAnnotation.text);
            res.status(200).send(results[0].fullTextAnnotation.text)
        })
        .catch(results => res.status(400).send("Please take picture again."));
    
}

async function generateOTP(otpLength){
    var code = [];

    for(var i = 0; i < otpLength; i++){
        code.push(Math.floor(Math.random() * 10));
    }

    return code.join('');
}

function cloudinaryImageUploadMethod(file){
    return new Promise(resolve => {
        const { path } = file;

        var fileExt = file.originalname.split('.');

        if(fileExt[fileExt.length - 1] == 'png' || fileExt[fileExt.length - 1] == 'jpeg' || fileExt[fileExt.length - 1] == 'jpg' ){
            cloudinary.uploader.upload(path, (err, res) => {
                if(err) return res.status(500).send('upload image error');
                resolve({
                    res: res.secure_url
                });
            });
        } else {
            cloudinary.uploader.upload(path, {resource_type: 'raw'}, (err, res) => {
                if(err) return res.status(500).send('upload image error');
                resolve({
                    res: res.secure_url
                });
            });
        }
    });
}

function validateReq (data){
    const emailRegExp = /^[-!#$%&'*+\/0-9=?A-Z^_a-z{|}~](\.?[-!#$%&'*+\/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/;
    if(Object.keys(data).length === 0) return { status: false, message: "You cannot leave the fields empty"};
    if(!emailRegExp.test(data.email)) return { status: false, message: "Email isn't correct"};
    if(!data.email) return { status: false, message: "Email cannot be empty"};
    if(!data.firstname) return { status: false, message: "Firstname cannot be empty"};
    if(!data.surname) return { status: false,  message: "Surname cannot be empty"};
    if(!data.birthday) return { status: false, message: "Birthday cannot be empty"};
    if(!data.gender) return { status: false, message: "Gender cannot be empty"};
    if(!data.maritals) return { status: false, message: "Maritals cannot be empty"};
    if(!data.phone) return { status: false, message: "Phone cannot be empty"};
    if(!data.occupation) return { status: false, message: "Occupation cannot be empty"};
    if(!data.password) return { status: false, message: "Password cannot be empty"};
    if(!data.hkidfirstname) return { status: false, message: "hkidfirstname cannot be empty"};
    if(!data.hkidsurname) return { status: false, message: "hkidsurname cannot be empty"};
    if(!data.hkidbirthday) return { status: false, message: "hkidbirthday cannot be empty"};
    if(!data.hkidgender) return { status: false, message: "hkidgender cannot be empty"};
    if(!data.address) return { status: false, message: "address cannot be empty"};
//     if(data.hkidfirstname != data.firstname) return { status: false, message: "firstname and hkidfirstname dont match."};
//     if(data.hkidsurname != data.surname) return { status: false, message: "surname and hkidsurname don't match."};
//     if(data.hkidbirthday != data.birthday) return { status: false, message: "birthday and hkidbirthday don't match."};
//     if(data.hkidgender != data.gender) return { status: false, message: "gender and hkidgender don't match."};
    
    return { status: true, message: "SUCCESS"};
}

async function resizeImage(rawImage, fileLoc){
    sharp(rawImage)
        .resize(500, 200)
        .rotate()
        .toFile(fileLoc); 
}

async function extractText(image) {

    const worker = createWorker({
        langPath: path.resolve("./") + '/lang-data', 
        logger: m => console.log(m),
    });

    return extratedText =  (async () => {
        await worker.load();
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        
        const { data: { text } } = await worker.recognize(image);
        await worker.terminate();
        return text;
        
    })();

}

module.exports = { userRegister, userAuth , sendOTP, verifyOTP, extracthkid, compareUserFaceWithHKIDFace, userEncryption};
