import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
import { createClient } from "@supabase/supabase-js";
import { setDefaultResultOrder } from "dns";

setDefaultResultOrder("ipv4first");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);