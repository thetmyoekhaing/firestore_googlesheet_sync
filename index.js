const { google } = require("googleapis");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK with service account
const serviceAccount = require("./jsons/google-services.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Authorize with Google Sheets API
async function authorizeGoogleSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile:"./sheet-services.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return auth.getClient();
}

// Read data from Google Sheets
async function getSheetData( sheetId, range,auth) {
  try {
    const sheets = google.sheets("v4");
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range:range,
      auth,
    });

  

    if (response.data && response.data.values) {
      return response.data.values;
    } else {
      console.log('No data found in the specified range.');
      return [];
    }
  } catch (error) {
    console.error('Error fetching sheet data:', error);
    return [];
  }
}// Function to get document ID for a given slug in a specified collection and field
async function getIdForSlug(collectionName, fieldName, slug) {
  const querySnapshot = await db.collection(collectionName).where(fieldName, "==", slug).limit(1).get();
  if (!querySnapshot.empty) {
    console.log(`Found document with ${fieldName}: ${slug} in ${collectionName}`);
    return querySnapshot.docs[0].id;
  } else {
    console.log(`No document found with ${fieldName}: ${slug} in ${collectionName}`);
    return null;
  }
}

// Function to upload 'dayslots' data, mapping slugs to references in a dynamic collection
async function updateData(collectionName, data, fieldNames, referenceSlugFieldName) {
  const batch = db.batch();

  for (const row of data) {
    const docData = {};
    let skipInsertion = false;

    for (let index = 0; index < fieldNames.length; index++) {
      const fieldName = fieldNames[index];
      const fieldValue = row[index] || null;

 

      if (fieldName.startsWith("UNIQUE:")) {
        // Handle fields prefixed with 'UNIQUE:', dynamically parsing collection name
        const [_, targetCollection] = fieldName.split(":"); // Extract collection name after 'UNIQUE:'
        const slugs = (fieldValue.startsWith("[") && fieldValue.endsWith("]")) ? fieldValue.replace(/\[|\]/g, '').split(',') : [fieldValue];
        const referencedIds = [];

        console.log(`Processing UNIQUE field '${fieldName}' with slugs: ${JSON.stringify(slugs)}`);

        for (const slug of slugs) {
          const docId = await getIdForSlug(targetCollection, referenceSlugFieldName, slug);
          if (docId) {
            referencedIds.push(db.collection(targetCollection).doc(docId)); // Store as a reference
          } else {
            console.log(`Skipping slug '${slug}' as it was not found in ${targetCollection}`);
          }
        }

        const referenceFieldName = targetCollection.toLowerCase(); // Use collection name as field key in lowercase
        docData[referenceFieldName] = referencedIds; // Set as an array of references

      } else {
        // Regular field
        // Regular field with list support
        const list = (fieldValue && fieldValue.startsWith("[") && fieldValue.endsWith("]"))
        ? fieldValue.replace(/\[|\]/g, '').split(',')
        : [fieldValue || null];

        // Assign `list` to `docData[fieldName]`
        docData[fieldName] = list.length > 1 ? list : list[0];

      }
    }

    if (!skipInsertion) {
      console.log(`Prepared document data for batch set: ${JSON.stringify(docData)}`);
      const docRef = db.collection(collectionName).doc(); // Autogenerate ID
      batch.set(docRef, docData);
    }
  }

  try {
    await batch.commit();
    console.log(`Data uploaded to Firestore successfully for ${collectionName} collection!`);
  } catch (error) {
    console.error("Error uploading data to Firestore:", error);
  }
}

// Main function
async function main() {
  const SHEET_ID = "1lQDAwNSSuGCt8BLd8kKggGRt67ptHd3mo2zssmRWvT8";
  const auth = await authorizeGoogleSheets();
  const timeslotsData = await getSheetData(SHEET_ID,"timeslots!A2:D",auth);
  const dayslotsData = await getSheetData(SHEET_ID, "dayslots!A2:C", auth); 
  const practitionersData = await getSheetData(SHEET_ID,"practitioners!A2:F",auth)
  const servicesData = await getSheetData(SHEET_ID, "services!A2:D",auth);
  const categoeiesData = await getSheetData(SHEET_ID, "categories!A2:C",auth);

 
  if (timeslotsData.length > 0) {
    console.log(`Fetched data: ${JSON.stringify(timeslotsData)}`);
    // Upload to Firestore, dynamically mapping 'UNIQUE:' references to document IDs
    await updateData("timeslots", timeslotsData, ["from", "to","slug"], null,);
  }
 
  if (dayslotsData.length > 0) {
    console.log(`Fetched data: ${JSON.stringify(dayslotsData)}`);
    // Upload to Firestore, dynamically mapping 'UNIQUE:' references to document IDs
    await updateData("dayslots", dayslotsData, ["date", "UNIQUE:timeslots","slug"], "slug");
  }

  if(practitionersData.length > 0) {
    console.log(`Fetched data: ${JSON.stringify(practitionersData)}`);
    // Upload to Firestore, dynamically mapping 'UNIQUE:' references to document IDs
    await updateData("practitioners", practitionersData, ["name", "experienceYears","ratingCount","specialities","profile","slug"], null,);
  }

  if(servicesData.length > 0) {
        console.log(`Fetched data: ${JSON.stringify(servicesData)}`);
    // Upload to Firestore, dynamically mapping 'UNIQUE:' references to document IDs
    await updateData("services", servicesData, ["name", "description","image","UNIQUE:practitioners"], "slug");

  }

  if(categoeiesData.length > 0) {
        console.log(`Fetched data: ${JSON.stringify(categoeiesData)}`);
    // Upload to Firestore, dynamically mapping 'UNIQUE:' references to document IDs
    await updateData("categories", categoeiesData, ["name", "image","UNIQUE:services"], "name");

  }

}

main();
