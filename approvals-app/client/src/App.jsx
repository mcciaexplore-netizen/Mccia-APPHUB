import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/layout/Layout.jsx";
import { ROUTES } from "./constants/routes.js";
import { AppProvider, useApp } from "./context/AppContext.jsx";
import Login from "./pages/auth/Login.jsx";
import Budgets from "./pages/admin/Budgets.jsx";
import Masters from "./pages/admin/Masters.jsx";
import Home from "./pages/dashboard/Home.jsx";
import RequestList from "./pages/dashboard/RequestList.jsx";
import ResubmitRequest from "./pages/dashboard/ResubmitRequest.jsx";
import SubmissionDetail from "./pages/dashboard/SubmissionDetail.jsx";
import NewDgExpenditure from "./pages/dg-approval/NewDgExpenditure.jsx";
import NewEvent from "./pages/events/NewEvent.jsx";
import NewExpenditure from "./pages/expenditure/NewExpenditure.jsx";
import NewHrRequest from "./pages/hr/NewHrRequest.jsx";
import NewReimbursement from "./pages/reimbursement/NewReimbursement.jsx";

function AppRoutes() {
  const { user, config } = useApp();
  if (user === undefined || (user && !config)) return <p className="p-8 text-gray-500">Loading…</p>;
  if (!user) return <Login />;
  const managers = (page) => (user.can_manage ? page : <Navigate to={ROUTES.home} />);
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/list" element={<RequestList />} />
        <Route path="/new/expenditure" element={<NewExpenditure />} />
        <Route path="/new/dg_expenditure" element={<NewDgExpenditure />} />
        <Route path="/new/hr" element={<NewHrRequest />} />
        <Route path="/new/reimbursement" element={<NewReimbursement />} />
        <Route path="/new/event" element={<NewEvent />} />
        <Route path="/edit/:id" element={<ResubmitRequest />} />
        <Route path="/submission/:id" element={<SubmissionDetail />} />
        <Route path="/budgets" element={managers(<Budgets />)} />
        <Route path="/masters" element={managers(<Masters />)} />
        <Route path="*" element={<Navigate to={ROUTES.home} />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppRoutes />
    </AppProvider>
  );
}
