'use server' // means never send this function to the client

export async function login(
  formData: FormData
) {
  const email =
    formData.get('email')

  const password =
    formData.get('password')

  console.log(email)
  console.log(password)
}

/* 
1. Get Session
2. Extract userId
3. Load Membership
4. Determine Permissions
5. Load Page Data

Login
   ↓
Verify Credentials
   ↓
Create Session
   ↓
Store Session
   ↓
Send Cookie
   ↓
Future Requests
   ↓
Identify User
   ↓
Load Membership
   ↓
Authorize Access
*/