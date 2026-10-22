/**
 * INDIA // ENVIRO.SYS -- Matrix / Y2K themed, all-India, timeline since 2016, animated scan
 * Pick any place in India (tap the map, or jump to a state / district / validated
 * site), choose a baseline and target month (last 24 months), then Analyze.
 * Drag the corner handles to resize the scan box (2-30 km per side); drag the + to move it.
 *
 * Needs: npx expo install react-native-webview
 * Two pages: SCAN (pick area + timeline; an animated overlay covers it while scanning)
 * and RESULTS (map with detections + readout). Android back returns from RESULTS to SCAN.
 * Set API_BASE_URL to your PC's LAN IP; Flask running; same WiFi.
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  StyleSheet, View, Text, ScrollView, TouchableOpacity,
  ActivityIndicator, SafeAreaView, StatusBar, Platform, Modal, BackHandler,
} from 'react-native';
import { WebView } from 'react-native-webview';

const API_BASE_URL = 'http://YOUR_PC_IP:5000';   // <-- your PC's LAN IP (run ipconfig)
const BOX_KM = 8;
const BOUNDS = { minLat: 6.0, maxLat: 37.5, minLon: 68.0, maxLon: 97.5 }; // rough bounding box of India (includes some neighbouring land)

// Validated sites first, then district HQs (approximate coordinates).
// District list for the app: one representative point INSIDE each district polygon.
// Generated from the open dataset github.com/udit-001/india-maps-data (mixed vintage: mostly 2011 Census districts,
// with newer boundaries for some states), so a few states are missing recently created districts.
// Tapping the map always works for any place, listed or not.
const DISTRICTS = {
  "Andaman and Nicobar Islands": [["Nicobars",7.008,93.798],["North and Middle Andaman",12.241,92.805],["South Andaman",10.732,92.486]],
  "Andhra Pradesh": [["Anantapur",14.441,77.474],["Chittoor",13.313,78.924],["East Godavari",17.133,82.039],["Guntur",16.254,80.185],["Krishna",16.448,81.036],["Kurnool",15.535,77.901],["Prakasam",15.649,79.517],["S.P.S. Nellore",14.297,79.778],["Srikakulam",18.653,83.986],["Visakhapatnam",17.898,82.567],["Vizianagaram",18.479,83.303],["West Godavari",17.008,81.337],["Y.S.R. Kadapa",14.439,78.688]],
  "Arunachal Pradesh": [["Anjaw",28.03,96.837],["Changlang",27.283,96.079],["East Kameng",27.543,92.954],["East Siang",28.086,95.415],["Kamle",27.748,94.123],["Kra Daadi",27.966,93.784],["Kurung Kumey",28.017,93.146],["Lepa Rada",27.925,94.746],["Lohit",28.01,96.169],["Longding",26.885,95.319],["Lower Dibang Valley",28.175,95.852],["Lower Siang",27.794,94.557],["Lower Subansiri",27.57,93.823],["Namsai",27.67,96.027],["Pakke Kessang",27.158,93.141],["Papum Pare",27.29,93.608],["Shi Yomi",28.671,94.242],["Siang",28.479,94.825],["Tawang",27.653,91.949],["Tirap",27.062,95.506],["Upper Dibang Valley",28.862,95.938],["Upper Siang",28.768,95.013],["Upper Subansiri",28.254,94.091],["West Kameng",27.338,92.438],["West Siang",28.193,94.559]],
  "Assam": [["Baksa",26.663,91.318],["Barpeta",26.386,91.043],["Biswanath",26.816,93.387],["Bongaigaon",26.346,90.621],["Cachar",24.754,92.87],["Charaideo",27.063,95.069],["Chirang",26.63,90.626],["Darrang",26.447,92.028],["Dhemaji",27.59,94.731],["Dhubri",26.131,89.855],["Dibrugarh",27.406,94.981],["Dima Hasao",25.37,93.087],["Goalpara",26.029,90.615],["Golaghat",26.406,93.99],["Hailakandi",24.552,92.612],["Hojai",26.007,92.948],["Jorhat",26.684,94.288],["Kamrup",26.127,91.289],["Kamrup Metropolitan",26.157,91.879],["Karbi Anglong",26.066,93.452],["Karimganj",24.587,92.37],["Kokrajhar",26.506,90.114],["Lakhimpur",27.25,94.251],["Majuli",27.038,94.355],["Morigaon",26.306,92.302],["Nagaon",26.334,92.754],["Nalbari",26.39,91.397],["Sivasagar",26.984,94.614],["Sonitpur",26.78,92.699],["South Salmara Mankachar",25.807,89.902],["Tinsukia",27.604,95.555],["Udalguri",26.75,92.03],["West Karbi Anglong",25.842,92.588]],
  "Bihar": [["Araria",26.247,87.375],["Arwal",25.181,84.663],["Aurangabad",24.822,84.409],["Banka",24.776,86.817],["Begusarai",25.487,86.114],["Bhagalpur",25.293,87.152],["Bhojpur",25.46,84.565],["Buxar",25.495,84.117],["Darbhanga",26.068,86.035],["East Champaran",26.625,84.892],["Gaya",24.678,84.991],["Gopalganj",26.407,84.381],["Jamui",24.741,86.32],["Jehanabad",25.172,85.001],["Kaimur",24.985,83.588],["Katihar",25.579,87.647],["Khagaria",25.496,86.628],["Kishanganj",26.291,87.931],["Lakhisarai",25.162,86.172],["Madhepura",25.796,86.941],["Madhubani",26.366,86.226],["Munger",25.199,86.539],["Muzaffarpur",26.17,85.314],["Nalanda",25.179,85.428],["Nawada",24.8,85.509],["Patna",25.473,85.183],["Purnia",25.768,87.386],["Rohtas",24.898,83.983],["Saharsa",25.827,86.609],["Samastipur",25.761,85.94],["Saran",25.928,84.77],["Sheikhpura",25.12,85.81],["Sheohar",26.497,85.274],["Sitamarhi",26.57,85.595],["Siwan",26.155,84.405],["Supaul",26.26,86.799],["Vaishali",25.774,85.393],["West Champaran",27.066,84.325]],
  "Chandigarh": [["Chandigarh",30.724,76.78]],
  "Chhattisgarh": [["Balod",20.737,81.16],["Baloda Bazar",21.57,82.423],["Balrampur",23.66,83.478],["Bametara",21.644,81.446],["Bastar",19.061,81.864],["Bijapur",18.806,80.76],["Bilaspur",22.385,82.07],["Dakshin Bastar Dantewada",18.875,81.401],["Dhamtari",20.541,81.722],["Durg",21.187,81.401],["Gariaband",20.422,82.256],["Janjgir Champa",22.025,82.666],["Jashpur",22.799,83.973],["Kabeerdham",22.132,81.267],["Kondagaon",19.709,81.746],["Korba",22.507,82.62],["Koriya",23.458,82.303],["Mahasamund",21.204,82.617],["Mungeli",22.266,81.652],["Narayanpur",19.568,81.129],["Raigarh",22.061,83.28],["Raipur",21.279,81.822],["Rajnandgaon",20.969,80.708],["Sukma",18.291,81.322],["Surajpur",23.366,82.959],["Surguja",22.969,83.177],["Uttar Bastar Kanker",20.139,81.005]],
  "Dadra and Nagar Haveli and Daman and Diu": [["Dadra and Nagar Haveli",20.204,73.049],["Daman",20.411,72.844],["Diu",20.722,70.969]],
  "Delhi": [["Delhi",28.637,77.109]],
  "Goa": [["North Goa",15.576,74.001],["South Goa",15.214,74.109]],
  "Gujarat": [["Ahmedabad",22.703,72.288],["Amreli",21.384,71.277],["Anand",22.487,72.754],["Aravalli",23.528,73.41],["Banaskantha",24.269,72.538],["Bharuch",21.816,72.982],["Bhavnagar",21.592,71.926],["Botad",22.032,71.631],["Chhota Udaipur",22.25,73.81],["Dahod",22.96,74.13],["Dang",20.774,73.707],["Devbhumi Dwarka",22.17,69.408],["Gandhinagar",23.265,72.672],["Gir Somnath",20.978,70.693],["Jamnagar",22.364,70.107],["Junagadh",21.355,70.446],["Kheda",22.847,72.979],["Kutch",23.784,69.629],["Mahisagar",23.186,73.666],["Mehsana",23.602,72.47],["Morbi",22.817,70.917],["Narmada",21.737,73.645],["Navsari",20.852,73.016],["Panchmahal",22.727,73.609],["Patan",23.784,71.694],["Porbandar",21.622,69.827],["Rajkot",22.076,71.033],["Sabarkantha",23.88,73.074],["Surat",21.155,72.96],["Surendranagar",22.85,71.63],["Tapi",21.199,73.581],["Vadodara",22.303,73.277],["Valsad",20.424,73.145],["Vav-Tharad",24.305,71.662]],
  "Haryana": [["Ambala",30.376,76.951],["Bhiwani",28.747,75.901],["Charkhi Dadri",28.593,76.129],["Faridabad",28.344,77.333],["Fatehabad",29.495,75.533],["Gurugram",28.357,76.918],["Hisar",29.239,75.813],["Jhajjar",28.575,76.609],["Jind",29.473,76.276],["Kaithal",29.765,76.448],["Karnal",29.721,76.915],["Kurukshetra",30.065,76.767],["Mahendragarh",28.151,76.176],["Nuh",28.055,77.041],["Palwal",28.037,77.324],["Panchkula",30.683,76.998],["Panipat",29.323,76.902],["Rewari",28.225,76.593],["Rohtak",28.903,76.554],["Sirsa",29.615,74.91],["Sonipat",29.044,76.919],["Yamunanagar",30.194,77.283]],
  "Himachal Pradesh": [["Bilaspur",31.382,76.625],["Chamba",32.69,76.178],["Hamirpur",31.636,76.553],["Kangra",32.088,76.274],["Kinnaur",31.572,78.309],["Kullu",31.902,77.412],["Lahaul and Spiti",32.494,77.644],["Mandi",31.623,77.014],["Shimla",31.249,77.75],["Sirmaur",30.717,77.413],["Solan",31.057,76.868],["Una",31.553,76.254]],
  "Jammu and Kashmir": [["Anantnag",33.797,75.252],["Bandipora",34.489,74.912],["Baramulla",34.159,74.326],["Budgam",33.956,74.66],["Doda",33.133,75.593],["Ganderbal",34.299,75.036],["Jammu",32.777,74.905],["Kathua",32.573,75.575],["Kishtwar",33.622,75.905],["Kulgam",33.611,74.818],["Kupwara",34.502,74.21],["Mirpur",33.239,73.819],["Muzaffarabad",34.635,73.811],["Pulwama",33.93,75.034],["Punch",33.83,74.004],["Rajouri",33.283,74.379],["Ramban",33.335,75.203],["Reasi",33.197,74.865],["Samba",32.553,75.093],["Shopiyan",33.72,74.78],["Srinagar",34.101,74.905],["Udhampur",32.893,75.345]],
  "Jharkhand": [["Bokaro",23.688,86.011],["Chatra",24.121,84.873],["Deoghar",24.343,86.705],["Dhanbad",23.861,86.444],["Dumka",24.31,87.285],["East Singhbhum",22.604,86.386],["Garhwa",24.025,83.68],["Giridih",24.323,86.163],["Godda",24.866,87.308],["Gumla",23.14,84.472],["Hazaribagh",24.086,85.483],["Jamtara",23.942,86.958],["Khunti",22.907,85.278],["Koderma",24.543,85.709],["Latehar",23.663,84.286],["Lohardaga",23.446,84.685],["Pakur",24.545,87.614],["Palamu",24.191,84.212],["Ramgarh",23.694,85.521],["Ranchi",23.298,85.371],["Sahibganj",25.017,87.695],["Saraikela-Kharsawan",22.835,85.932],["Simdega",22.605,84.554],["West Singhbhum",22.456,85.531]],
  "Karnataka": [["Bagalkote",16.29,75.588],["Ballari",15.193,76.635],["Belagavi",16.175,74.881],["Bengaluru Rural",13.189,77.335],["Bengaluru Urban",12.959,77.55],["Bidar",18.025,77.258],["Chamarajanagara",11.969,77.13],["Chikkaballapura",13.599,77.785],["Chikkamagaluru",13.434,75.641],["Chitradurga",14.288,76.547],["Dakshina Kannada",12.822,75.227],["Davanagere",14.363,75.886],["Dharwad",15.392,75.131],["Gadag",15.43,75.667],["Hassan",13.035,76.148],["Haveri",14.708,75.413],["Kalaburagi",17.234,76.765],["Kodagu",12.386,75.665],["Kolar",13.188,78.251],["Koppal",15.572,76.315],["Mandya",12.613,76.739],["Mysuru",12.219,76.599],["Raichur",16.019,76.911],["Ramanagara",12.729,77.335],["Shivamogga",14.022,75.241],["Tumakuru",13.404,76.864],["Udupi",13.514,74.888],["Uttara Kannada",14.747,74.623],["Vijayapura",16.814,75.881],["Yadgir",16.581,76.927]],
  "Kerala": [["Alappuzha",9.515,76.398],["Ernakulam",10.065,76.513],["Idukki",9.827,76.969],["Kannur",11.979,75.561],["Kasaragod",12.459,75.195],["Kollam",8.968,76.849],["Kottayam",9.639,76.636],["Kozhikode",11.464,75.877],["Malappuram",11.104,76.104],["Palakkad",10.815,76.465],["Pathanamthitta",9.237,76.974],["Thiruvananthapuram",8.543,77.063],["Thrissur",10.461,76.298],["Wayanad",11.713,76.133]],
  "Ladakh": [["Kargil",33.8,76.476],["Leh",34.701,78.227]],
  "Lakshadweep": [["Lakshadweep",8.268,73.041]],
  "Madhya Pradesh": [["Agar Malwa",23.882,76.095],["Alirajpur",22.286,74.359],["Anuppur",23.03,81.587],["Ashoknagar",24.553,77.881],["Balaghat",21.866,80.321],["Barwani",21.825,74.909],["Betul",21.89,77.869],["Bhind",26.344,78.72],["Bhopal",23.466,77.395],["Burhanpur",21.35,76.375],["Chhatarpur",24.761,79.67],["Chhindwara",22.225,78.79],["Damoh",23.757,79.555],["Datia",25.871,78.631],["Dewas",22.788,76.311],["Dhar",22.587,75.23],["Dindori",22.953,80.876],["Guna",24.503,77.256],["Gwalior",26.026,78.152],["Harda",22.254,77.119],["Hoshangabad",22.62,77.964],["Indore",22.732,75.794],["Jabalpur",23.236,80.003],["Jhabua",22.856,74.715],["Katni",23.714,80.257],["Khandwa",21.942,76.67],["Khargone",21.931,75.745],["Mandla",22.667,80.587],["Mandsaur",24.277,75.376],["Morena",26.384,77.845],["Narsinghpur",22.906,79.092],["Neemuch",24.61,75.183],["Niwari",25.31,78.751],["Panna",24.507,80.172],["Raisen",23.276,78.193],["Rajgarh",23.877,76.776],["Ratlam",23.476,74.923],["Rewa",24.741,81.682],["Sagar",23.833,78.733],["Satna",24.556,80.812],["Sehore",23.119,77.058],["Seoni",22.287,79.7],["Shahdol",23.622,81.431],["Shajapur",23.348,76.596],["Sheopur",25.755,76.914],["Shivpuri",25.358,77.862],["Sidhi",24.203,81.699],["Singrauli",24.297,82.423],["Tikamgarh",24.829,79.044],["Ujjain",23.327,75.707],["Umaria",23.633,80.946],["Vidisha",23.842,77.835]],
  "Maharashtra": [["Ahmednagar",19.166,74.821],["Akola",20.747,77.187],["Amravati",21.166,77.647],["Aurangabad",20.044,75.16],["Beed",18.994,75.666],["Bhandara",21.105,79.806],["Buldhana",20.579,76.404],["Chandrapur",20.082,79.509],["Dhule",21.116,74.436],["Gadchiroli",19.743,80.184],["Gondia",21.136,80.259],["Hingoli",19.576,77.172],["Jalgaon",20.827,75.511],["Jalna",19.917,75.864],["Kolhapur",16.502,74.091],["Latur",18.35,76.768],["Mumbai",19.089,72.892],["Nagpur",21.155,79.034],["Nanded",19.097,77.485],["Nandurbar",21.509,74.535],["Nashik",20.23,74.107],["Osmanabad",18.169,76.115],["Palghar",19.745,73.076],["Parbhani",19.296,76.608],["Pune",18.648,73.928],["Raigad",18.481,73.155],["Ratnagiri",17.294,73.461],["Sangli",17.172,75.279],["Satara",17.591,74.311],["Sindhudurg",16.115,73.704],["Solapur",17.859,75.259],["Thane",19.345,73.338],["Wardha",20.827,78.584],["Washim",20.339,77.249],["Yavatmal",20.072,78.341]],
  "Manipur": [["Bishnupur",24.506,93.797],["Chandel",24.172,94.011],["Churachandpur",24.281,93.676],["Imphal East",24.788,94.012],["Imphal West",24.783,93.864],["Jiribam",24.646,93.151],["Kakching",24.389,93.882],["Kamjong",24.798,94.396],["Kangpokpi",25.005,93.98],["Noney",24.678,93.513],["Pherzawl",24.308,93.251],["Senapati",25.385,94.167],["Tamenglong",25.073,93.556],["Tengnoupal",24.342,94.252],["Thoubal",24.621,94.004],["Ukhrul",25.286,94.46]],
  "Meghalaya": [["East Garo Hills",25.633,90.651],["East Jaintia Hills",25.255,92.486],["East Khasi Hills",25.4,91.817],["North Garo Hills",25.847,90.7],["Ribhoi",25.874,91.826],["South Garo Hills",25.343,90.539],["South West Garo Hills",25.433,90.001],["South West Khasi Hills",25.323,91.201],["West Garo Hills",25.577,90.244],["West Jaintia Hills",25.428,92.272],["West Khasi Hills",25.58,91.27]],
  "Mizoram": [["Aizawl",23.893,92.907],["Champhai",23.788,93.255],["Hnahthial",22.977,93.008],["Khawzawl",23.578,93.161],["Kolasib",24.235,92.722],["Lawngtlai",22.362,92.727],["Lunglei",23.002,92.633],["Mamit",23.762,92.449],["Saiha",22.41,93.061],["Serchhip",23.271,92.868]],
  "Nagaland": [["Dimapur",25.787,93.807],["Kiphire",25.791,94.844],["Kohima",25.744,94.115],["Longleng",26.589,94.795],["Mokokchung",26.491,94.523],["Mon",26.671,95.008],["Peren",25.449,93.615],["Phek",25.638,94.54],["Tuensang",26.14,94.911],["Wokha",26.258,94.215],["Zunheboto",25.972,94.456]],
  "Odisha": [["Angul",21.128,84.978],["Balangir",20.618,83.171],["Balasore",21.54,86.958],["Bargarh",21.207,83.558],["Bhadrak",20.962,86.603],["Boudh",20.638,83.989],["Cuttack",20.372,85.482],["Deogarh",21.469,84.784],["Dhenkanal",20.828,85.608],["Gajapati",19.201,84.18],["Ganjam",19.63,84.709],["Jagatsinghpur",20.163,86.331],["Jajpur",20.861,86.123],["Jharsuguda",21.796,83.963],["Kalahandi",19.803,83.041],["Kandhamal",20.121,84.074],["Kendrapara",20.56,86.545],["Kendujhar",21.581,85.669],["Khordha",20.019,85.52],["Koraput",18.745,82.603],["Malkangiri",18.294,81.975],["Mayurbhanj",21.932,86.402],["Nabarangapur",19.62,82.303],["Nayagarh",20.24,85.054],["Nuapada",20.511,82.538],["Puri",19.833,85.673],["Rayagada",19.423,83.463],["Sambalpur",21.52,84.15],["Subarnapur",20.858,83.853],["Sundargarh",22.065,83.909]],
  "Puducherry": [["Karaikal",10.904,79.811],["Mahe",11.731,75.544],["Puducherry",11.918,79.781],["Yanam",16.706,82.261]],
  "Punjab": [["Amritsar",31.783,74.839],["Barnala",30.365,75.505],["Bathinda",30.231,75.042],["Faridkot",30.618,74.791],["Fatehgarh Sahib",30.667,76.405],["Fazilka",30.315,74.112],["Ferozepur",30.864,74.644],["Gurdaspur",31.88,75.238],["Hoshiarpur",31.619,75.793],["Jalandhar",31.292,75.575],["Kapurthala",31.438,75.351],["Ludhiana",30.742,75.841],["Mansa",29.877,75.468],["Moga",30.771,75.154],["Pathankot",32.298,75.573],["Patiala",30.213,76.347],["Rupnagar",31.104,76.522],["S.A.S. Nagar",30.651,76.735],["Sangrur",30.219,75.862],["Shahid Bhagat Singh Nagar",31.076,76.178],["Sri Muktsar Sahib",30.278,74.501],["Tarn Taran",31.341,74.84]],
  "Rajasthan": [["Ajmer",26.366,74.712],["Alwar",27.642,76.605],["Banswara",23.481,74.341],["Baran",24.901,76.69],["Barmer",25.57,71.623],["Bharatpur",27.281,77.366],["Bhilwara",25.51,74.72],["Bikaner",28.175,73.148],["Bundi",25.442,75.756],["Chittorgarh",24.723,74.468],["Churu",28.196,74.652],["Dausa",26.817,76.448],["Dholpur",26.639,77.63],["Dungarpur",23.679,73.803],["Ganganagar",29.447,73.597],["Hanumangarh",29.384,74.299],["Jaipur",27.118,75.798],["Jaisalmer",27.058,70.787],["Jalore",25.22,72.325],["Jhalawar",24.315,76.311],["Jhunjhunu",28.098,75.556],["Jodhpur",26.745,72.876],["Karauli",26.471,77.027],["Kota",25.213,76.026],["Nagaur",27.03,74.162],["Pali",25.596,73.417],["Pratapgarh",23.995,74.605],["Rajsamand",25.317,73.839],["Sawai Madhopur",26.232,76.313],["Sikar",27.66,75.06],["Sirohi",24.806,72.817],["Tonk",26.169,75.578],["Udaipur",24.429,73.7]],
  "Sikkim": [["East Sikkim",27.296,88.681],["North Sikkim",27.729,88.51],["South Sikkim",27.32,88.375],["West Sikkim",27.317,88.165]],
  "Tamil Nadu": [["Ariyalur",11.19,79.288],["Chengalpattu",12.706,80.073],["Chennai",12.991,80.22],["Coimbatore",10.841,77.068],["Cuddalore",11.515,79.327],["Dharmapuri",12.164,78.206],["Dindigul",10.406,77.811],["Erode",11.488,77.353],["Kallakurichi",11.817,79.028],["Kancheepuram",12.767,79.809],["Kanyakumari",8.34,77.328],["Karur",10.825,78.203],["Krishnagiri",12.571,78.005],["Madurai",9.95,78.041],["Nagapattinam",11.201,79.708],["Namakkal",11.344,78.106],["Nilgiris",11.458,76.666],["Perambalur",11.269,78.918],["Pudukkottai",10.29,78.86],["Ramanathapuram",9.508,78.629],["Ranipet",12.949,79.442],["Salem",11.633,78.268],["Sivaganga",9.995,78.703],["Tenkasi",9.104,77.459],["Thanjavur",10.651,79.216],["Theni",9.868,77.422],["Thiruvallur",13.258,80.068],["Thiruvarur",10.662,79.502],["Thoothukkudi",8.842,77.989],["Tiruchirappalli",10.87,78.735],["Tirunelveli",8.66,77.519],["Tirupathur",12.535,78.614],["Tiruppur",10.777,77.494],["Tiruvannamalai",12.429,78.994],["Vellore",12.889,78.901],["Viluppuram",12.095,79.575],["Virudhunagar",9.494,77.864]],
  "Telangana": [["Adilabad",19.516,78.621],["Bhadradri Kothagudem",17.685,80.569],["Hyderabad",17.38,78.464],["Jagtial",18.842,78.891],["Jangaon",17.753,79.258],["Jayashankar Bhupalapally",18.518,79.96],["Jogulamba Gadwal",16.045,77.774],["Kamareddy",18.314,78.041],["Karimnagar",18.405,79.219],["Khammam",17.167,80.388],["Komaram Bheem",19.343,79.411],["Mahabubabad",17.708,80.02],["Mahabubnagar",16.712,77.985],["Mancherial",18.982,79.523],["Medak",17.928,78.213],["Medchal Malkajgiri",17.549,78.525],["Mulugu",18.284,80.308],["Nagarkurnool",16.443,78.627],["Nalgonda",16.853,79.206],["Narayanpet",16.669,77.603],["Nirmal",19.116,78.368],["Nizamabad",18.764,78.193],["Peddapalli",18.615,79.49],["Rajanna Sircilla",18.416,78.758],["Ranga Reddy",17.127,78.4],["Sangareddy",17.852,77.828],["Siddipet",18.05,78.91],["Suryapet",17.067,79.807],["Vikarabad",17.28,77.731],["Wanaparthy",16.258,78.037],["Warangal Rural",17.958,79.824],["Warangal Urban",18.062,79.452],["Yadadri Bhuvanagiri",17.429,79.073]],
  "Tripura": [["Dhalai",23.835,91.969],["Gomati",23.55,91.595],["Khowai",23.952,91.642],["North Tripura",24.117,92.248],["Sipahijala",23.536,91.301],["South Tripura",23.222,91.63],["Unokoti",24.222,92.04],["West Tripura",23.894,91.391]],
  "Uttar Pradesh": [["Agra",27.052,77.997],["Aligarh",27.867,78.148],["Ambedkar Nagar",26.416,82.652],["Amethi",26.3,81.621],["Amroha",28.704,78.296],["Auraiya",26.632,79.485],["Ayodhya",26.609,82.057],["Azamgarh",25.997,83.022],["Baghpat",29.07,77.301],["Bahraich",27.751,81.48],["Ballia",25.869,84.118],["Balrampur",27.454,82.392],["Banda",25.437,80.526],["Barabanki",26.979,81.347],["Bareilly",28.469,79.402],["Basti",26.84,82.555],["Bhadohi",25.359,82.503],["Bijnor",29.413,78.462],["Budaun",28.092,79.043],["Bulandshahr",28.408,77.97],["Chandauli",25.123,83.248],["Chitrakoot",25.223,81.12],["Deoria",26.432,83.732],["Etah",27.536,78.756],["Etawah",26.733,79.076],["Farrukhabad",27.412,79.487],["Fatehpur",25.838,80.911],["Firozabad",27.193,78.462],["Gautam Buddha Nagar",28.345,77.608],["Ghaziabad",28.757,77.466],["Ghazipur",25.605,83.503],["Gonda",27.118,81.925],["Gorakhpur",26.708,83.365],["Hamirpur",25.81,79.837],["Hapur",28.73,77.906],["Hardoi",27.323,80.095],["Hathras",27.579,78.115],["Jalaun",26.1,79.429],["Jaunpur",25.806,82.499],["Jhansi",25.526,78.905],["Kannauj",27.063,79.681],["Kanpur Dehat",26.415,79.848],["Kanpur Nagar",26.412,80.301],["Kasganj",27.784,78.827],["Kaushambi",25.527,81.452],["Kushinagar",26.92,83.821],["Lakhimpur Kheri",28.22,80.701],["Lalitpur",24.684,78.52],["Lucknow",26.84,80.899],["Maharajganj",27.17,83.483],["Mahoba",25.336,79.656],["Mainpuri",27.22,79.039],["Mathura",27.615,77.609],["Mau",26.03,83.497],["Meerut",29.03,77.765],["Mirzapur",24.943,82.642],["Moradabad",28.873,78.791],["Muzaffarnagar",29.421,77.73],["Pilibhit",28.469,80.089],["Pratapgarh",25.887,81.848],["Prayagraj",25.285,81.898],["Rae Bareli",26.24,81.117],["Rampur",28.83,79.177],["Saharanpur",30.018,77.538],["Sambhal",28.418,78.555],["Sant Kabir Nagar",26.743,83.017],["Shahjahanpur",27.952,79.777],["Shamli",29.468,77.299],["Shrawasti",27.681,81.898],["Siddharthnagar",27.28,82.866],["Sitapur",27.462,80.864],["Sonbhadra",24.438,83.061],["Sultanpur",26.27,82.248],["Unnao",26.594,80.607],["Varanasi",25.359,82.929]],
  "Uttarakhand": [["Almora",29.707,79.435],["Bageshwar",30.01,79.917],["Chamoli",30.492,79.607],["Champawat",29.246,80.091],["Dehradun",30.496,77.885],["Haridwar",29.926,77.989],["Nainital",29.316,79.42],["Pauri Garhwal",29.83,78.711],["Pithoragarh",30.112,80.467],["Rudraprayag",30.503,79.03],["Tehri Garhwal",30.442,78.506],["Udham Singh Nagar",29.04,79.446],["Uttarkashi",31.003,78.584]],
  "West Bengal": [["Alipurduar",26.665,89.455],["Bankura",23.159,87.208],["Birbhum",24.103,87.733],["Cooch Behar",26.256,89.425],["Dakshin Dinajpur",25.395,88.503],["Darjeeling",26.85,88.306],["Hooghly",22.914,88.015],["Howrah",22.452,88.036],["Jalpaiguri",26.674,88.739],["Jhargram",22.363,87.011],["Kalimpong",27.032,88.646],["Kolkata",22.595,88.363],["Malda",25.116,88.117],["Murshidabad",24.281,88.364],["Nadia",23.505,88.553],["North 24 Parganas",22.674,88.649],["Paschim Bardhaman",23.663,87.142],["Paschim Medinipur",22.379,87.412],["Purba Bardhaman",23.359,87.921],["Purba Medinipur",22.05,87.807],["Purulia",23.214,86.308],["South 24 Parganas",22.065,88.637],["Uttar Dinajpur",25.878,87.979]]
};

// Validated / test sites (shown as their own group in the picker)
const PLACES = [
  { name: '* SGNP / Aarey (validated)', lat: 19.225, lon: 72.90 },
  { name: '* Tungareshwar (validated)', lat: 19.45, lon: 73.00 },
  { name: '* Thane Creek (validated)', lat: 19.125, lon: 73.00 },
  { name: '* Karnala (validated)', lat: 18.90, lon: 73.15 },
  { name: '* Phansad (validated)', lat: 18.15, lon: 73.10 },
  { name: '* Bhimashankar (validated)', lat: 19.15, lon: 73.65 },
  { name: '* Tamhini / Mulshi (validated)', lat: 18.65, lon: 73.45 },
  { name: 'Sundarbans (mangrove test site)', lat: 21.95, lon: 89.00 },
];
const SITES_KEY = '__sites';
const GROUPS = { [SITES_KEY]: PLACES.map(p => [p.name.replace('* ', ''), p.lat, p.lon]), ...DISTRICTS };

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const START_YEAR = 2016;

// every full month since Jan 2016, oldest first -> value is YYYY-MM-15
function buildMonthOptions() {
  const now = new Date();
  const out = [];
  for (let y = START_YEAR, m = 0; new Date(y, m, 15) < new Date(now.getFullYear(), now.getMonth(), 1); ) {
    out.push({
      label: `${MONTHS[m].toUpperCase()} ${y}`,
      value: `${y}-${String(m + 1).padStart(2, '0')}-15`,
      monsoon: m >= 5 && m <= 8,
    });
    m += 1; if (m === 12) { m = 0; y += 1; }
  }
  return out;
}

const C = { bg: '#000', panel: '#020d05', green: '#00ff41', dim: '#0a9b2c', faint: '#0b3d17',
            red: '#ff2a4d', cyan: '#00e5ff', amber: '#ffb000' };
const MONO = Platform.select({ ios: 'Courier', default: 'monospace' });

const RAIN_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#000;overflow:hidden"><canvas id="c"></canvas><script>
var c=document.getElementById('c'),x=c.getContext('2d'),f=14,d=[],W=0,H=0;
var ch='ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789';
function fit(){   // re-read the size every tick: it can be 0 when the WebView first loads
  var w=window.innerWidth||document.documentElement.clientWidth, h=window.innerHeight||document.documentElement.clientHeight;
  if(!w||!h) return false;
  if(w!==W||h!==H){ W=c.width=w; H=c.height=h; d=[]; for(var i=0;i<Math.floor(W/f);i++) d[i]=Math.random()*H/f; x.fillStyle='#000'; x.fillRect(0,0,W,H); }
  return true;
}
setInterval(function(){
  if(!fit()) return;
  x.fillStyle='rgba(0,0,0,0.08)'; x.fillRect(0,0,W,H);
  x.fillStyle='#00ff41'; x.font=f+'px monospace';
  for(var i=0;i<d.length;i++){
    x.fillText(ch[Math.floor(Math.random()*ch.length)], i*f, d[i]*f);
    if(d[i]*f>H && Math.random()>0.975) d[i]=0;
    d[i]++;
  }
},50);
</script></body></html>`;

// Scan animation: a radar line sweeps a row of trees; each one is flagged red, falls, leaves a stump;
// then the forest regrows and it loops. Purely decorative -- it does not reflect real progress.
const LOAD_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;background:#000;overflow:hidden"><canvas id="c"></canvas><script>
var c=document.getElementById('c'),x=c.getContext('2d'),W=0,H=0,N=11,T=[],sx=0,pause=0;
for(var i=0;i<N;i++)T.push({f:(i+.5)/N,h:30+Math.random()*26,st:0,a:0,m:0});
function fit(){   // re-read the size every frame: it can be 0 when the WebView first loads
  var w=window.innerWidth||document.documentElement.clientWidth, h=window.innerHeight||document.documentElement.clientHeight;
  if(!w||!h) return false;
  if(w!==W||h!==H){ W=c.width=w; H=c.height=h; }
  return true;
}
function draw(t,col){
  x.save();x.translate(t.f*W,H-14);x.rotate(t.a);x.fillStyle=col;x.fillRect(-2,-10,4,10);
  if(t.st<3){for(var k=0;k<3;k++){var w=t.h*(.6-k*.12),y=-10-k*t.h*.28;
    x.beginPath();x.moveTo(-w/2,y);x.lineTo(w/2,y);x.lineTo(0,y-t.h*.42);x.fill();}}
  x.restore();
}
function frame(){
  if(fit()){
    x.fillStyle='#000';x.fillRect(0,0,W,H);
    x.strokeStyle='#0b3d17';x.beginPath();x.moveTo(0,H-14);x.lineTo(W,H-14);x.stroke();
    if(pause){pause--;if(!pause){T.forEach(function(t){t.st=0;t.a=0;t.m=0;});sx=0;}}
    else{sx+=W/240;if(sx>W+10)pause=50;}
    T.forEach(function(t){
      if(t.st==0&&sx>t.f*W)t.st=1;
      if(t.st==1){t.m++;if(t.m>18)t.st=2;}
      if(t.st==2){t.a+=.07;if(t.a>1.5){t.a=0;t.st=3;}}
      draw(t,t.st==0?'#00ff41':t.st==3?'#6b1026':'#ff2a4d');
    });
    if(!pause){var g=x.createLinearGradient(sx-40,0,sx,0);g.addColorStop(0,'rgba(0,255,65,0)');g.addColorStop(1,'rgba(0,255,65,.45)');
      x.fillStyle=g;x.fillRect(sx-40,0,40,H);x.fillStyle='#00ff41';x.fillRect(sx,0,2,H);}
  }
  requestAnimationFrame(frame);
}
frame();
</script></body></html>`;

// Satellite map tinted phosphor-green. Static HTML; the app drives it via injectJavaScript.
const MAP_HTML = `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css"/>
<style>html,body,#m{height:100%;margin:0;background:#000}
.leaflet-tile-pane{filter:grayscale(1) brightness(.8) contrast(1.25) sepia(1) hue-rotate(78deg) saturate(2.6)}
.leaflet-control-attribution{background:rgba(0,0,0,.7)!important;color:#0a9b2c!important}
.leaflet-control-zoom a{background:#000;color:#00ff41;border-color:#0b3d17}</style></head><body><div id="m"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script>
var colors = {clearing:'#ff2a4d', construction:'#00e5ff', farmland:'#ffb000', afforestation:'#ffffff', other:'#6b7280'};
var map = L.map('m', {maxBounds:[[5.0,66.0],[38.5,99.0]], minZoom:4}).setView([22.5,79.0], 5);
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {maxZoom:18, attribution:'Imagery &copy; Esri'}).addTo(map);
var KM=111, MINKM=2, MAXKM=30;
var bbox=null, rect=null, corners=[], mover=null, layer=null;   // bbox = [south, west, north, east]
function kmLon(lat){ return KM*Math.cos(lat*Math.PI/180); }
function clampKm(v){ return Math.max(MINKM, Math.min(MAXKM, v)); }
function dims(){ if(!bbox) return [8,8]; return [(bbox[3]-bbox[1])*kmLon((bbox[0]+bbox[2])/2), (bbox[2]-bbox[0])*KM]; }
function post(){ window.ReactNativeWebView.postMessage(JSON.stringify({bbox:[bbox[1],bbox[0],bbox[3],bbox[2]]})); }
function cornerPts(){ return [[bbox[0],bbox[1]],[bbox[0],bbox[3]],[bbox[2],bbox[3]],[bbox[2],bbox[1]]]; }
var SIGN=[[-1,-1],[-1,1],[1,1],[1,-1]];   // direction of each corner from its opposite one
function icon(html){ return L.divIcon({className:'', html:html, iconSize:[0,0]}); }
var sq='<div style="width:28px;height:28px;margin:-14px 0 0 -14px;border:2px solid #00ff41;background:rgba(0,0,0,.65)"></div>';
var cross='<div style="width:34px;height:34px;margin:-17px 0 0 -17px;border:2px solid #00ff41;border-radius:50%;background:rgba(0,0,0,.65);color:#00ff41;font:bold 18px monospace;text-align:center;line-height:30px">+</div>';
function sync(skip){
  var c=cornerPts(); rect.setBounds([[bbox[0],bbox[1]],[bbox[2],bbox[3]]]);
  corners.forEach(function(m,i){ if(i!==skip) m.setLatLng(c[i]); });
  mover.setLatLng([(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2]);
}
function draw(){
  if(rect) map.removeLayer(rect);
  corners.forEach(function(m){ map.removeLayer(m); }); corners=[];
  if(mover) map.removeLayer(mover);
  rect = L.rectangle([[bbox[0],bbox[1]],[bbox[2],bbox[3]]], {color:'#00ff41', weight:2, dashArray:'6 4', fillOpacity:0.06, interactive:false}).addTo(map);
  cornerPts().forEach(function(pt,idx){
    var m = L.marker(pt, {draggable:true, icon:icon(sq)}).addTo(map);
    m.on('drag', function(ev){
      var c=cornerPts(), o=c[(idx+2)%4], p=ev.target.getLatLng(), mid=(o[0]+p.lat)/2;
      var hKm=clampKm(Math.abs(p.lat-o[0])*KM), wKm=clampKm(Math.abs(p.lng-o[1])*kmLon(mid));
      var plat=o[0]+SIGN[idx][0]*hKm/KM, plon=o[1]+SIGN[idx][1]*wKm/kmLon(mid);
      ev.target.setLatLng([plat,plon]);
      bbox=[Math.min(o[0],plat), Math.min(o[1],plon), Math.max(o[0],plat), Math.max(o[1],plon)];
      sync(idx);
    });
    m.on('dragend', function(){ draw(); post(); });
    corners.push(m);
  });
  mover = L.marker([(bbox[0]+bbox[2])/2,(bbox[1]+bbox[3])/2], {draggable:true, icon:icon(cross)}).addTo(map);
  var start=null;
  mover.on('dragstart', function(){ start={bbox:bbox.slice(), c:mover.getLatLng()}; });
  mover.on('drag', function(ev){
    var c=ev.target.getLatLng(), dLat=c.lat-start.c.lat, dLng=c.lng-start.c.lng;
    bbox=[start.bbox[0]+dLat, start.bbox[1]+dLng, start.bbox[2]+dLat, start.bbox[3]+dLng];
    sync(-1);
  });
  mover.on('dragend', function(){ draw(); post(); });
}
function setBox(b, fly){ bbox=b; draw(); if(fly) map.fitBounds([[b[0],b[1]],[b[2],b[3]]], {padding:[40,40]}); post(); }
function setCenter(lat, lon, fly){
  var d=dims(), hl=d[1]/2/KM, hw=d[0]/2/kmLon(lat);
  setBox([lat-hl, lon-hw, lat+hl, lon+hw], fly);
}
function setSize(km){
  km=clampKm(km); var lat=(bbox[0]+bbox[2])/2, lon=(bbox[1]+bbox[3])/2;
  setBox([lat-km/2/KM, lon-km/2/kmLon(lat), lat+km/2/KM, lon+km/2/kmLon(lat)], true);
}
function setZones(zones){
  if(layer) map.removeLayer(layer);
  layer = L.layerGroup().addTo(map);
  zones.forEach(function(z){
    var c = colors[z.driver_type] || colors.clearing;
    L.geoJSON(z.geometry, {interactive:false, style:{color:c, weight:2, fillColor:c, fillOpacity:0.55}}).addTo(layer);
  });
}
map.createPane('lc'); map.getPane('lc').style.zIndex = 250; map.getPane('lc').style.pointerEvents = 'none';
var lcLayer=null, lcUrl=null, lcOn=true;
function setLC(url){
  if(lcLayer){ map.removeLayer(lcLayer); lcLayer=null; }
  lcUrl = url;
  if(url && lcOn){ lcLayer = L.tileLayer(url, {pane:'lc', opacity:0.5, maxZoom:18}).addTo(map); }
}
function showLC(on){ lcOn = on; setLC(lcUrl); }
map.on('click', function(e){ setCenter(e.latlng.lat, e.latlng.lng, false); });
</script></body></html>`;

// View-only map for the RESULTS page (no handles): scanned box, detections, optional farmland layer.
const buildResultHtml = (result, showFarm) => {
  const data = JSON.stringify({
    zones: result.zones || [], bbox: result.bbox, lc: showFarm ? (result.landcover_tiles || null) : null,
  }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css"/>
<style>html,body,#m{height:100%;margin:0;background:#000}
.leaflet-tile-pane{filter:grayscale(1) brightness(.8) contrast(1.25) sepia(1) hue-rotate(78deg) saturate(2.6)}
.leaflet-control-attribution{background:rgba(0,0,0,.7)!important;color:#0a9b2c!important}
.leaflet-control-zoom a{background:#000;color:#00ff41;border-color:#0b3d17}</style></head><body><div id="m"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js"></script>
<script>
var D = ${data};
var colors = {clearing:'#ff2a4d', construction:'#00e5ff', farmland:'#ffb000', afforestation:'#ffffff', other:'#6b7280'};
var map = L.map('m', {maxBounds:[[5.0,66.0],[38.5,99.0]], minZoom:4});
L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {maxZoom:18, attribution:'Imagery &copy; Esri'}).addTo(map);
map.createPane('lc'); map.getPane('lc').style.zIndex = 250; map.getPane('lc').style.pointerEvents = 'none';
if (D.lc) L.tileLayer(D.lc, {pane:'lc', opacity:0.5, maxZoom:18}).addTo(map);
var b = D.bbox;
L.rectangle([[b[1],b[0]],[b[3],b[2]]], {color:'#00ff41', weight:2, dashArray:'6 4', fill:false, interactive:false}).addTo(map);
map.fitBounds([[b[1],b[0]],[b[3],b[2]]], {padding:[20,20]});
D.zones.forEach(function(z){
  var c = colors[z.driver_type] || colors.clearing;
  L.geoJSON(z.geometry, {interactive:false, style:{color:c, weight:2, fillColor:c, fillOpacity:0.55}}).addTo(map);
});
</script></body></html>`;
};

const kmDims = (b) => ({ w: (b[2] - b[0]) * 111 * Math.cos(((b[1] + b[3]) / 2) * Math.PI / 180), h: (b[3] - b[1]) * 111 });

// Illustrative pipeline stages shown while waiting (a ticker, not real progress).
const STAGES = [
  '> ACQUIRING BASELINE IMAGERY (SENTINEL-2)',
  '> FUSING RADAR BACKSCATTER (SENTINEL-1)',
  '> MASKING CLOUDS AND WATER',
  '> COMPUTING PER-PIXEL CHANGE SCORE',
  '> CLASSIFYING LAND COVER (DYNAMIC WORLD AI)',
  '> SEPARATING CLEARING / FARMLAND / GAIN',
  '> ESTIMATING BIOMASS LOSS',
];

// Dark themed dropdown (a modal list) -- avoids the white native picker popup.
function Select({ value, options, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const cur = options.find(o => o.value === value);
  return (
    <>
      <TouchableOpacity style={s.select} onPress={() => setOpen(true)}>
        <Text style={s.selectText} numberOfLines={1}>{cur ? cur.label : placeholder}</Text>
        <Text style={s.selectCaret}>v</Text>
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={s.modalBg}>
          <View style={s.modalBox}>
            <ScrollView>
              {options.map(o => (
                <TouchableOpacity key={o.value} style={[s.opt, o.value === value && s.optOn]}
                  onPress={() => { setOpen(false); onChange(o.value); }}>
                  <Text style={[s.optText, o.value === value && { color: C.bg }]}>{o.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.close} onPress={() => setOpen(false)}>
              <Text style={s.selectText}>[ CLOSE ]</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Panel({ title, children }) {
  return (
    <View style={s.panel}>
      <Text style={s.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

export default function App() {
  const months = useMemo(buildMonthOptions, []);
  const monthOpts = useMemo(() => months.map(m => ({ label: m.label, value: m.value })).reverse(), [months]);
  const [grp, setGrp] = useState(SITES_KEY);
  const stateOpts = useMemo(() => [
    { label: 'VALIDATED / TEST SITES', value: SITES_KEY },
    ...Object.keys(DISTRICTS).sort().map(k => ({ label: k.toUpperCase() + ` (${DISTRICTS[k].length})`, value: k })),
  ], []);
  const distOpts = useMemo(() => GROUPS[grp].map((d, i) => ({ label: d[0].toUpperCase(), value: String(i) })), [grp]);
  const feb = months.filter(m => m.value.slice(5, 7) === '02' && m.value >= '2022-01-01');   // sensible defaults
  const [label, setLabel] = useState('SGNP / AAREY (validated)');
  const [bbox, setBbox] = useState(null);   // [west, south, east, north]
  const [progress, setProgress] = useState(null);
  const [showLC, setShowLC] = useState(true);
  const [scanKey, setScanKey] = useState(0);   // fresh scan-animation WebView per scan
  const [rainKey, setRainKey] = useState(0);   // fresh rain WebView whenever the scan page is shown
  const [screen, setScreen] = useState('scan');   // 'scan' | 'results'
  const cancelRef = useRef(false);
  const labelRef = useRef(null);
  const [baseline, setBaseline] = useState(feb[0].value);
  const [target, setTarget] = useState(feb[feb.length - 1].value);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const webRef = useRef(null);

  const run = (js) => webRef.current?.injectJavaScript(`${js};true;`);
  const isMonsoon = (v) => months.find(m => m.value === v)?.monsoon;

  useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (mapReady) run(`setCenter(${PLACES[0].lat}, ${PLACES[0].lon}, true)`);
  }, [mapReady]);

  useEffect(() => {   // the SCAN page stays mounted (hidden) while RESULTS is shown
    if (mapReady && screen === 'scan') run('map.invalidateSize()');
  }, [screen, mapReady]);

  useEffect(() => { if (screen === 'scan') setRainKey(k => k + 1); }, [screen]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (loading) { cancelRef.current = true; setLoading(false); return true; }
      if (screen === 'results') { setScreen('scan'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [screen, loading]);

  const onMapMessage = (e) => {
    try {
      const { bbox: b } = JSON.parse(e.nativeEvent.data);
      setBbox(b);
      setLabel(labelRef.current || 'CUSTOM AREA');
      labelRef.current = null;
      setResult(null); setError(null);
    } catch (_) {}
  };

  const pickDistrict = (idx) => {
    const d = GROUPS[grp][Number(idx)];
    if (!d) return;
    labelRef.current = grp === SITES_KEY ? d[0].toUpperCase() : `${d[0]}, ${grp}`.toUpperCase();
    run(`setCenter(${d[1]}, ${d[2]}, true)`);
  };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const analyze = async () => {
    if (!bbox) { setError('ERR: MAP NOT READY.'); return; }
    if (baseline >= target) { setError('ERR: BASELINE MUST PRECEDE TARGET.'); return; }
    const cLat = (bbox[1] + bbox[3]) / 2, cLon = (bbox[0] + bbox[2]) / 2;
    if (cLat < BOUNDS.minLat || cLat > BOUNDS.maxLat || cLon < BOUNDS.minLon || cLon > BOUNDS.maxLon) {
      setError('ERR: BOX CENTRE OUTSIDE INDIA.'); return;
    }
    cancelRef.current = false;
    setScanKey(k => k + 1);
    setLoading(true); setError(null); setResult(null); setProgress(null);
    try {
      const resp = await fetch(`${API_BASE_URL}/api/analyze/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bbox, baseline_date: baseline, target_date: target }),
      });
      const job = await resp.json();
      if (!resp.ok) { setError('ERR: ' + (job.message || job.error || 'COULD NOT START SCAN')); return; }
      setProgress({ done: 0, total: job.total });
      const deadline = Date.now() + 15 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(2000);
        if (cancelRef.current) return;
        const r = await fetch(`${API_BASE_URL}/api/analyze/status/${job.job_id}`);
        const j = await r.json();
        if (!r.ok) { setError('ERR: ' + (j.message || 'JOB LOST')); return; }
        setProgress({ done: j.done, total: j.total });
        if (j.status === 'done') { setResult(j.result); setScreen('results'); return; }
        if (j.status === 'error') { setError('ERR: ' + (j.error?.message || j.error?.error || 'SCAN FAILED')); return; }
      }
      setError('ERR: SCAN TIMED OUT.');
    } catch (e) {
      setError(`ERR: NO LINK TO ${API_BASE_URL}. CHECK FLASK + SAME WIFI.`);
    } finally { setLoading(false); }
  };

  const dim = bbox ? kmDims(bbox) : { w: 8, h: 8 };
  const tiles = Math.max(1, Math.ceil(dim.w / 12)) * Math.max(1, Math.ceil(dim.h / 12));
  const estSec = tiles <= 1 ? '40-120s' : `${Math.ceil(tiles / 3) * 60}-${Math.ceil(tiles / 3) * 120}s`;

  const imp = result?.impact;
  const resultHtml = useMemo(() => (result ? buildResultHtml(result, showLC) : null), [result, showLC]);
  const cancelScan = () => { cancelRef.current = true; setLoading(false); };

  return (
    <SafeAreaView style={s.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* ============ PAGE 1: SCAN ============ */}
      <View style={{ flex: 1, display: screen === 'scan' ? 'flex' : 'none' }}>
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          <View style={s.header}>
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <WebView key={rainKey} originWhitelist={['*']} source={{ html: RAIN_HTML }} scrollEnabled={false}
                style={{ flex: 1, backgroundColor: '#000' }} />
            </View>
            <View style={s.titleWrap}>
              <Text style={s.title}>INDIA//ENVIRO.SYS</Text>
              <Text style={s.sub}>SATELLITE CHANGE DETECTION  [ONLINE]</Text>
            </View>
          </View>

          <Panel title="01 // SELECT SECTOR">
            <Select value={grp} options={stateOpts} onChange={setGrp} placeholder="> CHOOSE STATE / UT..." />
            <View style={{ height: 8 }} />
            <Select value="" options={distOpts} onChange={pickDistrict} placeholder="> CHOOSE DISTRICT / SITE..." />
            <Text style={s.coords}>
              {label} :: BOX {dim.w.toFixed(1)} x {dim.h.toFixed(1)} KM ({Math.round(dim.w * dim.h * 100).toLocaleString()} HA)
            </Text>
            <Text style={s.label}>QUICK SIZE (OR DRAG THE CORNER HANDLES ON THE MAP)</Text>
            <View style={s.chipRow}>
              {[2, 8, 15, 30].map(k => (
                <TouchableOpacity key={k} style={s.chip} onPress={() => bbox && run(`setSize(${k})`)}>
                  <Text style={s.chipText}>{k} KM</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.map}>
              <WebView ref={webRef} originWhitelist={['*']} source={{ html: MAP_HTML }}
                style={{ flex: 1, backgroundColor: '#000' }} javaScriptEnabled domStorageEnabled
                nestedScrollEnabled onMessage={onMapMessage} onLoadEnd={() => setMapReady(true)} />
            </View>
            <Text style={s.legend}>TAP=MOVE  DRAG CORNERS=RESIZE (2-30 KM)</Text>
          </Panel>

          <Panel title="02 // TIMELINE  (SINCE 2016)">
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>BASELINE</Text>
                <Select value={baseline} options={monthOpts} onChange={setBaseline} />
              </View>
              <View style={{ width: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.label}>TARGET</Text>
                <Select value={target} options={monthOpts} onChange={setTarget} />
              </View>
            </View>
            {tiles > 1 && <Text style={s.warn}>! LARGE AREA: SCANNED IN {tiles} TILES, SO IT TAKES LONGER.</Text>}
            {(baseline < '2019-01-01' || target < '2019-01-01') && (
            <Text style={s.warn}>! BEFORE 2019 THE SATELLITE ARCHIVE IS SPARSE: A SCAN MAY FIND NO IMAGERY AND RESULTS ARE ROUGHER.</Text>
          )}
          {(isMonsoon(baseline) || isMonsoon(target)) && (
              <Text style={s.warn}>! JUN-SEP = MONSOON OVER MUCH OF INDIA. CLOUD MAY BLOCK IMAGERY. WINTER MONTHS OFTEN WORK BEST.</Text>
            )}
          </Panel>

          <TouchableOpacity style={[s.btn, loading && s.btnOff]} onPress={analyze} disabled={loading}>
            <Text style={s.btnText}>[ EXECUTE SCAN ]</Text>
          </TouchableOpacity>
          {error && <Text style={s.error}>{error}</Text>}
        </ScrollView>
      </View>

      {/* ============ PAGE 2: RESULTS ============ */}
      <View style={{ flex: 1, display: screen === 'results' ? 'flex' : 'none' }}>
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          <TouchableOpacity style={s.back} onPress={() => setScreen('scan')}>
            <Text style={s.btnText}>[ BACK TO SCAN ]</Text>
          </TouchableOpacity>

          {result && (
            <Panel title="03 // SCAN RESULT">
              <Text style={s.coords}>
                {`${label} :: ${result.width_km} x ${result.height_km} KM :: ${baseline.slice(0, 7)} TO ${target.slice(0, 7)}`}
              </Text>
              <View style={s.resMap}>
                {resultHtml && (
                  <WebView originWhitelist={['*']} source={{ html: resultHtml }} javaScriptEnabled
                    domStorageEnabled nestedScrollEnabled style={{ flex: 1, backgroundColor: '#000' }} />
                )}
              </View>
              <TouchableOpacity style={[s.chip, { marginTop: 6, marginRight: 0 }]} onPress={() => setShowLC(v => !v)}>
                <Text style={s.chipText}>FARMLAND LAYER: {showLC ? 'ON' : 'OFF'}</Text>
              </TouchableOpacity>
              <Text style={s.legend}>
                <Text style={{ color: C.red }}>RED=CLEARING</Text> <Text style={{ color: C.cyan }}>CYAN=NEW CONSTRUCTION</Text> <Text style={{ color: C.amber }}>AMBER=FARMLAND CHANGE</Text> <Text style={{ color: '#fff' }}>WHITE=AFFORESTATION</Text>{'\n'}AMBER SHADE = ALL FARMLAND (ESA WORLDCOVER 2021)
              </Text>
            </Panel>
          )}

          {imp && (
            <Panel title="04 // READOUT">
              <Row label="DEFORESTED (FOREST LOSS)" value={`${imp.deforested_area_ha} HA (${imp.deforestation_pct_of_aoi}%)`} />
              <Row label="NEW CONSTRUCTION" value={`${imp.new_construction_ha ?? 0} HA`} />
              <Row label="AFFORESTED (GAIN)" value={`${imp.afforested_area_ha ?? 0} HA`} />
              <Row label="NET (GAIN - LOSS)" value={`${imp.net_change_ha ?? 0} HA`} />
              <Row label="FARMLAND CHANGE" value={`${imp.farmland_change_ha ?? 0} HA (NOT COUNTED)`} />
              <Row label="LOSS RATE" value={`${imp.deforestation_rate_ha_per_year} HA/YR`} />
              <Row label="SCAN AREA" value={`${result.width_km} x ${result.height_km} KM`} />
              <Row label="FOREST+SCRUB (EXTENT)" value={`${imp.forest_extent_ha ?? 0} HA`} />
              <Row label="FARMLAND (EXTENT)" value={`${imp.farmland_extent_ha ?? 0} HA`} />
              <Row label="BIOMASS LOSS (EST)"
                value={imp.biomass_loss_tonnes != null ? `${Math.round(imp.biomass_loss_tonnes).toLocaleString()} T${imp.biomass_truncated ? ' (PARTIAL)' : ''}` : 'N/A'} />
              <Text style={s.note}>
                // CANDIDATE DETECTIONS, SINGLE COMPARISON, NOT PERSISTENCE-FILTERED.{'\n'}
                // DEFORESTED = LOSS WHERE THE LAND WAS TREES/SCRUB (DYNAMIC WORLD). ONLY NEW CONSTRUCTION IS REPORTED (BUILDINGS ALREADY THERE AT BASELINE ARE IGNORED). CHANGED FARMLAND IS ONLY WHERE CHANGE WAS DETECTED; THE FARMLAND LAYER SHOWS ALL FARMLAND.{'\n'}
                // FARMLAND = REPEATING GREEN/BARE CYCLES OVER THE LAST 24 MONTHS (SENTINEL-2), WITH ESA WORLDCOVER 2021 AS A FALLBACK. WATER/WETLAND CHANGE IS IGNORED. FOREST + AFFORESTATION USE DYNAMIC WORLD + EVI GAIN OF AT LEAST 0.10: HEURISTIC, NOT CALIBRATED ON THE 7 SITES. AFFORESTATION CANNOT TELL NEW FOREST FROM PLANTATIONS/ORCHARDS.{'\n'}
                {imp.landcover_used === false ? '// LAND COVER UNAVAILABLE HERE: FARMLAND + AFFORESTATION NOT CLASSIFIED.\n' : ''}// DEFORESTATION MODEL CALIBRATED ON WESTERN GHATS / MUMBAI SITES.{'\n'}
                // BIOMASS FROM 2010 300M DATASET. RATE = LINEAR AVG OVER {imp.period_years} YRS.
              </Text>
            </Panel>
          )}
        </ScrollView>
      </View>

      {/* ============ SCAN OVERLAY: page stays visible, translucent, behind ============ */}
      {loading && (
        <View style={s.overlay}>
          <View style={s.overlayCard}>
            <Text style={s.overlayTitle}>{'> SCAN IN PROGRESS'}</Text>
            <View style={{ height: 140 }} pointerEvents="none">
              <WebView key={scanKey} originWhitelist={['*']} source={{ html: LOAD_HTML }} scrollEnabled={false}
                javaScriptEnabled style={{ flex: 1, backgroundColor: '#000' }} />
            </View>
            <Text style={s.stage}>{STAGES[Math.floor(elapsed / 4) % STAGES.length]}</Text>
            <Text style={s.coords}>T+{elapsed}s  //  EST. {estSec}{progress && progress.total > 1 ? `  //  TILES ${progress.done}/${progress.total}` : ''}</Text>
            <TouchableOpacity style={s.cancel} onPress={cancelScan}>
              <Text style={s.selectText}>[ CANCEL ]</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const glow = { textShadowColor: C.green, textShadowRadius: 8, textShadowOffset: { width: 0, height: 0 } };

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0 },
  header: { height: 96, borderWidth: 1, borderColor: C.green, justifyContent: 'center', overflow: 'hidden' },
  titleWrap: { backgroundColor: 'rgba(0,0,0,0.7)', alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: C.dim },
  title: { color: C.green, fontFamily: MONO, fontSize: 17, fontWeight: '700', letterSpacing: 1, ...glow },
  sub: { color: C.dim, fontFamily: MONO, fontSize: 10, marginTop: 2, textAlign: 'center' },
  panel: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.faint, padding: 10, marginTop: 12 },
  panelTitle: { color: C.green, fontFamily: MONO, fontSize: 12, marginBottom: 8, ...glow },
  label: { color: C.dim, fontFamily: MONO, fontSize: 10, marginBottom: 3 },
  row: { flexDirection: 'row' },
  select: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: C.dim, backgroundColor: '#000', paddingHorizontal: 10, paddingVertical: 10 },
  selectText: { color: C.green, fontFamily: MONO, fontSize: 13, flexShrink: 1 },
  selectCaret: { color: C.green, fontFamily: MONO, marginLeft: 8 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', padding: 20 },
  modalBox: { maxHeight: '80%', borderWidth: 1, borderColor: C.green, backgroundColor: '#000' },
  opt: { paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.faint },
  optOn: { backgroundColor: C.green },
  optText: { color: C.green, fontFamily: MONO, fontSize: 13 },
  close: { padding: 12, alignItems: 'center', borderTopWidth: 1, borderTopColor: C.green },
  chipRow: { flexDirection: 'row', marginTop: 4, marginBottom: 4 },
  chip: { flex: 1, borderWidth: 1, borderColor: C.dim, paddingVertical: 8, alignItems: 'center', marginRight: 6, backgroundColor: '#000' },
  chipText: { color: C.green, fontFamily: MONO, fontSize: 12 },
  coords: { color: C.dim, fontFamily: MONO, fontSize: 10, marginTop: 8 },
  map: { height: 340, marginTop: 8, borderWidth: 1, borderColor: C.dim },
  legend: { color: C.dim, fontFamily: MONO, fontSize: 10, marginTop: 6, textAlign: 'center' },
  warn: { color: C.amber, fontFamily: MONO, fontSize: 11, marginTop: 8 },
  btn: { borderWidth: 2, borderColor: C.green, backgroundColor: '#04200b', paddingVertical: 14,
    alignItems: 'center', marginTop: 14 },
  btnOff: { borderColor: C.faint },
  btnText: { color: C.green, fontFamily: MONO, fontWeight: '700', fontSize: 15, letterSpacing: 2, ...glow },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 20, elevation: 20, backgroundColor: 'rgba(0,0,0,0.78)', justifyContent: 'center', padding: 20 },
  overlayCard: { borderWidth: 1, borderColor: C.green, backgroundColor: 'rgba(0,10,3,0.94)', padding: 14 },
  overlayTitle: { color: C.green, fontFamily: MONO, fontSize: 14, fontWeight: '700', marginBottom: 10, ...glow },
  cancel: { borderWidth: 1, borderColor: C.dim, paddingVertical: 10, alignItems: 'center', marginTop: 14 },
  back: { borderWidth: 1, borderColor: C.green, backgroundColor: '#04200b', paddingVertical: 12, alignItems: 'center' },
  resMap: { height: 400, marginTop: 8, borderWidth: 1, borderColor: C.dim },
  scanBox: { borderWidth: 1, borderColor: C.dim, backgroundColor: '#000', marginTop: 12, padding: 8 },
  stage: { color: C.green, fontFamily: MONO, fontSize: 12, marginTop: 8, ...glow },
  error: { color: C.red, fontFamily: MONO, fontSize: 12, marginTop: 10 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7,
    borderBottomWidth: 1, borderBottomColor: C.faint },
  detailLabel: { color: C.dim, fontFamily: MONO, fontSize: 12 },
  detailValue: { color: C.green, fontFamily: MONO, fontSize: 13, fontWeight: '700', flexShrink: 1,
    textAlign: 'right', marginLeft: 8, ...glow },
  note: { color: C.dim, fontFamily: MONO, fontSize: 9, marginTop: 10, lineHeight: 14 },
});
