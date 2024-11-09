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
  async function getSheetData(sheetId, range, auth) {
    try {
      const sheets = google.sheets("v4");
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: range,
        auth,
      });

      if (response.data && response.data.values) {
        return response.data.values;
      } else {
        console.log("No data found in the specified range.");
        return [];
      }
    } catch (error) {
      console.error("Error fetching sheet data:", error);
      return [];
    }
  }
  async function getIdForSlug(collectionName, fieldName, slug) {
    if (!fieldName || !slug) {
      console.error("Invalid fieldName or slug:", fieldName, slug);
      return null;
    }

    try {
      const querySnapshot = await db.collection(collectionName).where(fieldName, "==", slug).limit(1).get();
      if (!querySnapshot.empty) {
        console.log(`Found document with ${fieldName}: ${slug} in ${collectionName}`);
        return querySnapshot.docs[0].data().id;
      } else {
        console.log(`No document found with ${fieldName}: ${slug} in ${collectionName}`);
        return null;
      }
    } catch (error) {
      console.error(`Error fetching document ID for slug ${slug}:`, error);
      return null;
    }
  }

  // Function to upload 'dayslots' data, mapping slugs to references in a dynamic collection
  async function updateData(collectionName, data, fieldNames) {
    const batch = db.batch();

    for (const row of data) {
      const docData = { id: generateUUID() };
      let skipInsertion = false;

      for (let index = 0; index < fieldNames.length; index++) {
        const fieldName = fieldNames[index];
        const fieldValue = row[index] || null;
        const listPattern = /^\[.*\]$/;
        const mapPattern = /^\{.*\}$/;
        let parsedValue;

        if (fieldName.startsWith("ref:")) {
          const [_, targetCollection, referenceSlugFieldName] = fieldName.split(":");
          // if (!fieldValue) {
          //   console.warn(`Skipping reference for ${fieldName} due to empty field value.`);
          //   continue;
          // }
          const slugs = fieldValue.startsWith("[") ? fieldValue.replace(/\[|\]/g, "").split(",") : [fieldValue];
          const referencedIds = [];

          for (const slug of slugs) {
            const docId = await getIdForSlug(targetCollection, referenceSlugFieldName, slug.trim());
            console.log(`return id ${docId}`);
            if (docId) {
              referencedIds.push(docId);
            } else {
              console.log(`Skipping slug '${slug}' as it was not found in ${targetCollection}`);
            }
          }
          docData[targetCollection.toLowerCase()] = referencedIds.length > 0 ? referencedIds : null;

        } else {
          if (fieldValue && listPattern.test(fieldValue)) {
            parsedValue = fieldValue.replace(/\[|\]/g, "").split(",");
          } else if (fieldValue && mapPattern.test(fieldValue)) {
            try {
              parsedValue = JSON.parse(fieldValue);
            } catch (e) {
              console.error("Invalid map format", e);
              parsedValue = fieldValue;
            }
          } else {
            parsedValue = fieldValue;
            console.log("parse val " + parsedValue)
          }
          docData[fieldName] = typeof parsedValue === "string" && !isNaN(parsedValue) 
          ? parseInt(parsedValue, 10) 
          : parsedValue;   
     }
      }

      if (!skipInsertion) {
        const docRef = db.collection(collectionName).doc();
        batch.set(docRef, docData);
      }
    }

    try {
      await batch.commit();
      console.log(`Data uploaded successfully to ${collectionName} collection!`);
    } catch (error) {
      console.error("Error uploading data to Firestore:", error);
    }
  }

  async function deleteCollection(collectionPath, batchSize = 50) {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.limit(batchSize);
  
    return new Promise((resolve, reject) => {
      deleteQueryBatch(query, resolve, reject);
    });
  }
  
  async function deleteQueryBatch(query, resolve, reject) {
    try {
      const snapshot = await query.get();
  
      if (snapshot.empty) {
        resolve();
        return;
      }
  
      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });
  
      await batch.commit();
      process.nextTick(() => {
        deleteQueryBatch(query, resolve, reject);
      });
    } catch (error) {
      reject(error);
    }
  }
  


  // Main function
  async function main() {
    const SHEET_ID = "1lQDAwNSSuGCt8BLd8kKggGRt67ptHd3mo2zssmRWvT8";
    const auth = await authorizeGoogleSheets();
    await deleteCollection("practitioners")
    // await deleteCollection("services")
    // await deleteCollection("categories")
    const practitionersData = await getSheetData(SHEET_ID, "practitioners!A2:G", auth);

    // const servicesData = await getSheetData(SHEET_ID, "services!A2:E", auth);
    // const categoriesData = await getSheetData(SHEET_ID, "categories!A2:C", auth);

    if (practitionersData.length > 0) {
      await updateData("practitioners", practitionersData, ["name", "experienceYears", "ratingCount", "specialities", "profile", "slug","availableTime"]);
    }

    // if (servicesData.length > 0) {
    //   await updateData("services", servicesData, ["name", "description", "image", "ref:practitioners:slug", "duration"]);
    // }

    // if (categoriesData.length > 0) {
    //   await updateData("categories", categoriesData, ["name", "image", "ref:services:name","ref:practitioners:slug"]);
    // }
  }

  main();


  // UUID Generation Function
  function generateUUID() {
    const _sym = "abcdefghijklmnopqrstuvwxyz1234567890";
    let str = "";
    for (let i = 0; i < 8; i++) {  // Generate an 8-character ID
      str += _sym[parseInt(Math.random() * _sym.length)];
    }
    return str;
  }




