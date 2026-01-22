
// docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/javascript_s3_code_examples.html

import AdmZip from "adm-zip";
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";

import { CHANGES_NAME } from "./tracking";

// const UPLOAD_URL = "http://127.0.0.1:8000/upload";
const UPLOAD_URL = "https://vacuum-validator.rkthomps.com/upload";

function createZipBuffer(sourceDir: string): Buffer {
    const zip = new AdmZip();

    function addFolder(folder: string, basePath = "") {
        const entries = fs.readdirSync(folder, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(folder, entry.name);
            const relativePath = path.join(basePath, entry.name);

            if (entry.isDirectory()) {
                addFolder(fullPath, relativePath);
            } else {
                zip.addLocalFile(fullPath, basePath);
            }
        }
    }

    addFolder(sourceDir);

    // Get the full ZIP **as a Buffer** — no disk written
    return zip.toBuffer();
}


/**
 * 
 * @param changesPath Path to the changes directory. This will generally correspond to a specific commit. 
 * Todo: When do delete old change directories? Some # of days?
 */
export async function upload(changesPath: string): Promise<void> {
    if (!fs.existsSync(changesPath)) {
        console.error(`Changes directory does not exist at ${changesPath}`);
        return;
    }

    const zipBuffer = createZipBuffer(changesPath);

    const form = new FormData();
    // `file` must match your FastAPI parameter name
    form.append("file", zipBuffer, "archive.zip");

    const response = await axios.post(UPLOAD_URL, form, {
        headers: form.getHeaders(),   // includes multipart boundary
        maxBodyLength: 20 * 1024 * 1024,    // 20 MB
        maxContentLength: 20 * 1024 * 1024,
    });

    console.log("Upload response:", response.data);
}


