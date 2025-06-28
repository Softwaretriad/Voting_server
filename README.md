# 🗳️ Voting System API

This is a RESTful API built with **Node.js**, **Express**, and **MongoDB** to power an online voting platform. It supports schools, election commission (EC) members, voters, candidates, and elections.

---

## 📁 Features

- 🔐 **Authentication & Authorization**
  - JWT-based login for EC members and voters
- 🏫 **School Management**
  - Add school with subscription plan
  - Manage up to 5 EC members per school
- 👥 **Voter Management**
  - Bulk upload voters
  - Verification before voting
- 🗳️ **Election Workflow**
  - Upload candidates
  - Start and manage elections
  - Prevent multiple votes
- 📊 **Dashboard Analytics**
  - EC dashboard: voter count, vote count, candidate stats
  - Voter dashboard: status & voting window

---

## ⚙️ Tech Stack

- **Backend:** Node.js, Express
- **Database:** MongoDB (Mongoose ODM)
- **Authentication:** JWT
- **Environment Management:** dotenv

---

## 🚀 Getting Started

### Clone the repository

```bash
git clone https://github.com/Softwaretriad/Voting_server
cd Voting_server

npm install

### Create .env file
PORT=5000
MONGO_URI=mongodb://localhost:27017/Askme
JWT_SECRET=your_jwt_secret

### Start Server
npm run dev


## 📌 API Endpoints

### 🔐 Auth Routes

| Method | Endpoint               | Description                     |
|--------|------------------------|---------------------------------|
| POST   | `/api/ec/register`     | Register new EC user            |
| POST   | `/api/ec/login`        | Login EC user                   |
| POST   | `/api/voter/login`     | Login voter                     |

---

### 🏫 EC Management

| Method | Endpoint                     | Description                      |
|--------|------------------------------|----------------------------------|
| POST   | `/api/ec/add`                | Add EC member to school          |
| DELETE | `/api/ec/:ecId`              | Remove EC member                 |
| GET    | `/api/ec/list/:schoolId`     | Get EC members for a school      |

---

### 👥 Voter & Candidate Management

| Method | Endpoint                            | Description                     |
|--------|--------------------------------------|---------------------------------|
| POST   | `/api/voters/upload`                | Upload voter list (bulk)        |
| GET    | `/api/candidates`                   | List all candidates (EC view)   |
| POST   | `/api/election/upload-candidates`   | Upload candidates for election  |

---

### 🗳️ Election Process

| Method | Endpoint                        | Description                     |
|--------|----------------------------------|---------------------------------|
| POST   | `/api/election/start`           | Start election (EC only)        |
| GET    | `/api/ec/dashboard`             | View election analytics         |
| GET    | `/api/voter/dashboard/:voterId` | Voter dashboard view            |
| POST   | `/api/vote`                     | Cast vote (voter only)          |


